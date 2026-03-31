import express from "express";
import { createServer as createViteServer } from "vite";
import basicAuth from "express-basic-auth";
import dotenv from "dotenv";
import path from "path";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { marked } from "marked";
import cron from "node-cron";
import nodemailer from "nodemailer";

import { initDB, getDB, processChannel, processPendingDownloads, processPendingAnalysis } from "./services/dbService";
import { fetchRecentVideos } from "./services/youtubeService";
import { isEmailConfigured } from "./services/emailService";

dotenv.config();

// ---------------------------------------------------------------------------
// Supported Channels
// ---------------------------------------------------------------------------
const CHANNELS = [
  {
    id: "gooaye_videos",
    handle: "@Gooaye",
    type: "videos",
    name: "股癌 Gooaye (影片)",
  },
  {
    id: "yutinghao_streams",
    handle: "@yutinghaofinance",
    type: "streams",
    name: "游庭皓的財經皓角 (直播)",
  },
  {
    id: "s178_videos",
    handle: "@s178",
    type: "videos",
    name: "郭哲榮分析師-摩爾證券投顧 (影片)",
  },
  {
    id: "s178_streams",
    handle: "@s178",
    type: "streams",
    name: "郭哲榮分析師-摩爾證券投顧 (直播)",
  },
];

// ---------------------------------------------------------------------------
// Auth middleware — protects sensitive internal routes
// ---------------------------------------------------------------------------
function internalAuth() {
  const user = process.env.INTERNAL_AUTH_USER;
  const pass = process.env.INTERNAL_AUTH_PASS;

  if (!user || !pass) {
    console.warn(
      "[Security] INTERNAL_AUTH_USER / INTERNAL_AUTH_PASS not set. " +
      "Sensitive routes (/api/config, /api/trigger-cron, /api/send-email) " +
      "will return 503 until these are configured.",
    );
    // Return a middleware that always rejects
    return (_req: express.Request, res: express.Response) => {
      res.status(503).json({
        error: "Internal auth not configured. Set INTERNAL_AUTH_USER and INTERNAL_AUTH_PASS.",
      });
    };
  }

  return basicAuth({
    users: { [user]: pass },
    challenge: true,
    realm: "FinanceAI Internal",
  });
}

// ---------------------------------------------------------------------------
// Cron Job
// ---------------------------------------------------------------------------
/** Runs the full pipeline: detect new videos → download → analyze */
async function runFullPipeline(channels: typeof CHANNELS) {
  console.log(`[Pipeline] Checking ${channels.length} channel(s)...`);
  for (const channel of channels) {
    await processChannel(channel);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.log("[Pipeline] Processing pending downloads...");
  await processPendingDownloads();
  console.log("[Pipeline] Processing pending analysis...");
  await processPendingAnalysis();
  console.log("[Pipeline] Done.");
}

function setupCronJob() {
  if (process.env.DISABLE_CRON === "true") {
    console.log("[Cron] DISABLE_CRON=true — cron job is OFF. Use POST /api/run-pipeline to trigger manually.");
    return;
  }
  cron.schedule(
    "*/30 * * * *",
    async () => {
      try {
        console.log("Running scheduled video check for all channels (every 30 mins)...");
        await runFullPipeline(CHANNELS);
      } catch (error) {
        console.error("Error in cron job execution:", error);
      }
    },
    { timezone: "Asia/Taipei" },
  );
  console.log("Cron job scheduled: every 30 minutes.");
}

// ---------------------------------------------------------------------------
// Server Bootstrap
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ----- Public routes -----

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      prefix: process.env.GEMINI_API_KEY?.substring(0, 5),
    });
  });

  // ----- Protected routes (require Basic Auth) -----

  const auth = internalAuth();

  /** Returns runtime config — protected because it exposes the Gemini API key */
  app.get("/api/config", auth, (_req, res) => {
    res.json({ geminiApiKey: process.env.GEMINI_API_KEY });
  });

  /** Manually trigger the cron pipeline for a single channel (K8s CronJob use-case) */
  app.post("/api/trigger-cron", auth, async (req, res) => {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId in request body" });
    }

    const channel = CHANNELS.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Fire-and-forget — response is returned immediately
    processChannel(channel).catch(console.error);

    res.json({ success: true, message: `Cron job triggered for ${channel.name}` });
  });

  /**
   * 🧪 手動測試端點 — 直接指定一部影片 URL 進行分析。
   *
   * 用途：本機測試時不需等 Cron，直接把想測試的影片丟進來跑完整流程。
   *
   * ── 模式 A：指定影片 URL（最常用）──────────────────────────────────────
   * POST /api/run-pipeline
   * { "videoUrl": "https://www.youtube.com/watch?v=Xxzj8CA0LDc" }
   *
   * 效果：
   *   1. 從 URL 解析 videoId
   *   2. 在 Firestore 建立（或重置）文件，status → PENDING_DOWNLOAD
   *   3. 執行 processPendingDownloads（yt-dlp 下載 + 上傳 Storage）
   *   4. 執行 processPendingAnalysis（Gemini 逐字稿 + 摘要）
   *
   * ── 模式 B：只跑已排隊的任務（不抓新影片）─────────────────────────────
   * POST /api/run-pipeline
   * { "pendingOnly": true }
   *
   * 效果：直接跑 processPendingDownloads + processPendingAnalysis
   * 適合：Firestore 裡已有 PENDING_DOWNLOAD 文件，只想推進處理
   */
  app.post("/api/run-pipeline", auth, async (req, res) => {
    const db = getDB();
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { videoUrl, channelId, channelName, pendingOnly } = req.body || {};

    // ── 模式 A：指定影片 URL ────────────────────────────────────────────────
    if (videoUrl) {
      // Extract video ID
      let videoId: string | null = null;
      const vMatch = (videoUrl as string).match(/v=([^&]+)/);
      if (vMatch) {
        videoId = vMatch[1];
      } else {
        const shortMatch = (videoUrl as string).match(/youtu\.be\/([^?]+)/);
        if (shortMatch) videoId = shortMatch[1];
      }

      if (!videoId) {
        return res.status(400).json({ error: "Cannot extract video ID from provided videoUrl" });
      }

      // Resolve channel info if channelId given, otherwise use generic label
      const ch = CHANNELS.find((c) => c.id === channelId);
      const resolvedChannelId = ch?.id ?? channelId ?? "manual_test";
      const resolvedChannelName = ch?.name ?? channelName ?? "手動測試";

      const docId = `${resolvedChannelId}_${videoId}`;
      const docRef = doc(db, "video_summaries", docId);

      // Always fully overwrite so we can re-test the same video cleanly
      // (clears old transcript/summary from previous runs)
      await setDoc(docRef, {
        channel_id: resolvedChannelId,
        channel_name: resolvedChannelName,
        video_id: videoId,
        video_url: videoUrl,
        title: `手動測試 - ${videoId}`,
        status: "PENDING_DOWNLOAD",
        retries: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });  // setDoc without merge = full overwrite (clears old transcript/summary)

      console.log(`[/api/run-pipeline] Queued video ${videoId} for full pipeline.`);

      // Run pipeline in background
      Promise.resolve()
        .then(() => processPendingDownloads())
        .then(() => processPendingAnalysis())
        .catch((err) => console.error("[/api/run-pipeline] Error:", err));

      return res.json({
        success: true,
        mode: "video_url",
        docId,
        videoId,
        videoUrl,
        status: "PENDING_DOWNLOAD",
        message: "影片已加入佇列，開始執行：下載音檔 → Gemini 逐字稿 → 財經摘要",
        note: "在 server log 中追蹤進度，或至 Firestore 查看 status 欄位變化",
        checkStatus: `/api/summary?url=${encodeURIComponent(videoUrl as string)}`,
      });
    }

    // ── 模式 B：只跑已排隊的 pending 任務 ──────────────────────────────────
    if (pendingOnly) {
      console.log("[/api/run-pipeline] Running pending tasks only (no channel scrape).");
      Promise.resolve()
        .then(() => processPendingDownloads())
        .then(() => processPendingAnalysis())
        .catch((err) => console.error("[/api/run-pipeline] Error:", err));

      return res.json({
        success: true,
        mode: "pending_only",
        message: "正在處理 Firestore 中所有 PENDING_DOWNLOAD / PENDING_ANALYSIS 的任務",
        note: "在 server log 中追蹤進度",
      });
    }

    // ── 參數不足時回傳使用說明 ───────────────────────────────────────────────
    return res.status(400).json({
      error: "Missing required parameter",
      usage: {
        "模式A_指定影片": {
          method: "POST",
          path: "/api/run-pipeline",
          body: {
            videoUrl: "https://www.youtube.com/watch?v=Xxzj8CA0LDc",
            channelId: "(optional) gooaye_videos",
            channelName: "(optional) 股癌 Gooaye",
          },
        },
        "模式B_只跑排隊任務": {
          method: "POST",
          path: "/api/run-pipeline",
          body: { pendingOnly: true },
        },
      },
      availableChannelIds: CHANNELS.map((c) => ({ id: c.id, name: c.name })),
    });
  });

  /** Fetch recent videos from a YouTube channel page */
  app.get("/api/recent-videos", async (req, res) => {
    const channelHandle = (req.query.channel as string) || "@Gooaye";
    const type = (req.query.type as string) || "videos";

    try {
      const videos = await fetchRecentVideos(channelHandle, type);
      res.json(videos);
    } catch (e: any) {
      if (e.message === "YouTube fetch timeout") {
        res.status(504).json({ error: "YouTube fetch timeout" });
      } else {
        console.error("Failed to fetch YouTube videos:", e);
        res.status(500).json({ error: "Failed to fetch videos" });
      }
    }
  });

  /** Get cached AI summary for a video URL, or enqueue it for processing */
  app.get("/api/summary", async (req, res) => {
    const url = req.query.url as string;
    const channelId = (req.query.channelId as string) || "unknown";
    const channelName = (req.query.channelName as string) || "Unknown Channel";

    if (!url) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    const db = getDB();
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    try {
      // Extract video ID from URL
      let videoId: string;
      const vMatch = url.match(/v=([^&]+)/);
      if (vMatch) {
        videoId = vMatch[1];
      } else {
        const shortMatch = url.match(/youtu\.be\/([^?]+)/);
        videoId = shortMatch ? shortMatch[1] : encodeURIComponent(url);
      }

      const q = query(
        collection(db, "video_summaries"),
        where("video_url", "==", url),
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const docData = querySnapshot.docs[0].data();
        if (docData.status === "COMPLETED") {
          return res.json({ summary: docData.summary, status: "COMPLETED" });
        } else if (docData.status === "FAILED") {
          return res.json({ summary: "分析失敗，請聯絡管理員。", status: "FAILED" });
        } else {
          return res.json({ summary: "資料分析中，請稍後再試...", status: docData.status });
        }
      }

      // Not found — create a new task with consistent field names
      const docId = `${channelId}_${videoId}`;
      const docRef = doc(db, "video_summaries", docId);

      await setDoc(docRef, {
        channel_id: channelId,
        channel_name: channelName,
        video_id: videoId,
        video_url: url,
        title: "Requested via Web",
        status: "PENDING_DOWNLOAD",
        retries: 0,                        // ← was incorrectly "download_attempts" before
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Kick off background processing asynchronously
      setTimeout(() => {
        processPendingDownloads()
          .then(() => processPendingAnalysis())
          .catch(console.error);
      }, 1000);

      return res.json({
        summary: "已加入分析排程，資料分析中，請稍後再試...",
        status: "PENDING_DOWNLOAD",
      });
    } catch (error) {
      console.error("Error fetching summary from DB:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  /** Check SMTP configuration status */
  app.get("/api/email-status", (_req, res) => {
    const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
    const missing = required.filter((key) => !process.env[key]);
    res.json({ configured: missing.length === 0, missing });
  });

  /** Send an arbitrary email — protected to prevent SMTP abuse */
  app.post("/api/send-email", auth, async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields: to, subject, body" });
    }

    if (!isEmailConfigured()) {
      return res.status(500).json({
        error: "Email service is not configured. Please set SMTP environment variables.",
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      const parsedHtml = await marked.parse(body);
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
            <h2 style="color: #0f172a; margin: 0; font-size: 24px;">知名財經 YouTuber AI</h2>
            <p style="color: #64748b; font-size: 14px; margin-top: 8px;">為您整理的最新財經重點</p>
          </div>
          <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
            ${parsedHtml}
          </div>
          <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            <p>此信件由 AI 自動摘要生成，僅供參考，不構成投資建議。</p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"財經 AI 秘書" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text: body,
        html,
      });

      res.json({ success: true, message: "Email sent successfully" });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // ----- Static / Vite middleware -----

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Global error handler (catches URIError from malicious scans, etc.)
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err instanceof URIError) {
        console.warn(`[Security] Caught URIError from ${req.ip}: ${req.originalUrl}`);
        return res.status(400).send("Bad Request");
      }
      next(err);
    },
  );

  app.listen(PORT, "0.0.0.0", async () => {
    await initDB();
    console.log(`Server running on http://localhost:${PORT}`);
    setupCronJob();
  });
}

startServer();
