import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import https from "https";
import { marked } from "marked";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GoogleGenAI } from "@google/genai";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

dotenv.config();

// Supported Channels
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

let db: any;
let storage: any;

async function initDB() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      storage = getStorage(firebaseApp);
      console.log("Firebase initialized.");
    } else {
      console.warn(
        "firebase-applet-config.json not found. Firebase will not be initialized.",
      );
    }
  } catch (error) {
    console.error("Firebase init error:", error);
  }
}

// Helper to send email
async function sendSummaryEmail(to: string[], subject: string, body: string) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.error("Email service is not configured. Cannot send cron email.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const parsedHtml = await marked.parse(body);

  const emailTemplate = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.8; color: #334155; max-width: 850px; margin: 0 auto; padding: 20px; background-color: #ffffff; font-size: 19px;">
      <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
        <h2 style="color: #0f172a; margin: 0; font-size: 28px;">財經 AI 秘書</h2>
        <p style="color: #64748b; font-size: 17px; margin-top: 8px;">為您整理的最新財經重點</p>
      </div>
      <div style="background-color: #f8fafc; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
        ${parsedHtml}
      </div>
      <div style="margin-top: 30px; text-align: center; font-size: 14px; color: #94a3b8; padding-top: 20px; border-top: 1px solid #e2e8f0;">
        <p>此信件由 AI 自動摘要生成，僅供參考，不構成投資建議。</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"財經 AI 秘書" <${process.env.SMTP_USER}>`,
    to: to.join(", "),
    subject,
    text: body,
    html: emailTemplate,
  });
}

// Helper to fetch latest video
function fetchLatestVideo(channelHandle: string, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const tabName = type === "streams" ? "streams" : "videos";
    https
      .get(`https://www.youtube.com/${channelHandle}/${tabName}`, (ytRes) => {
        let data = "";
        ytRes.on("data", (chunk) => (data += chunk));
        ytRes.on("end", () => {
          try {
            const match = data.match(
              /var ytInitialData = (\{.*?\});<\/script>/,
            );
            if (match) {
              const json = JSON.parse(match[1]);
              const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
              const videosTab = tabs.find(
                (t: any) =>
                  t.tabRenderer &&
                  t.tabRenderer.content &&
                  t.tabRenderer.content.richGridRenderer,
              );
              const items =
                videosTab.tabRenderer.content.richGridRenderer.contents;
              const latestItem = items.find(
                (i: any) =>
                  i.richItemRenderer &&
                  i.richItemRenderer.content &&
                  i.richItemRenderer.content.videoRenderer,
              );

              if (latestItem) {
                const v = latestItem.richItemRenderer.content.videoRenderer;
                resolve({
                  title: v.title?.runs?.[0]?.text || "Unknown Title",
                  videoId: v.videoId,
                  url: "https://www.youtube.com/watch?v=" + v.videoId,
                  date: v.publishedTimeText?.simpleText || "",
                });
              } else {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

// State Machine Logic
async function processChannel(channel: {
  id: string;
  handle: string;
  type: string;
  name: string;
}) {
  try {
    const latestVideo = await fetchLatestVideo(channel.handle, channel.type);
    if (!latestVideo) {
      console.log(`Could not fetch latest video for ${channel.name}.`);
      return;
    }

    if (!db) {
      console.warn("DB not initialized, skipping check");
      return;
    }

    const docId = `${channel.id}_${latestVideo.videoId}`;
    const docRef = doc(db, "video_summaries", docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      console.log(
        `Latest video already recorded for ${channel.name}:`,
        latestVideo.title,
      );
      return;
    }

    console.log(`New video found for ${channel.name}:`, latestVideo.title);
    await setDoc(docRef, {
      channel_id: channel.id,
      channel_name: channel.name,
      video_id: latestVideo.videoId,
      video_url: latestVideo.url,
      title: latestVideo.title,
      status: "PENDING_DOWNLOAD",
      retries: 0,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error in processing channel ${channel.name}:`, error);
  }
}

let isDownloading = false;
async function processPendingDownloads() {
  if (!db || !storage || isDownloading) return;
  isDownloading = true;
  try {
    const q = query(
      collection(db, "video_summaries"),
      where("status", "==", "PENDING_DOWNLOAD"),
    );
    const querySnapshot = await getDocs(q);

    for (const document of querySnapshot.docs) {
      const data = document.data();
      const docRef = doc(db, "video_summaries", document.id);

      try {
        await updateDoc(docRef, { status: "DOWNLOADING" });

        const cacheDir = path.join(process.cwd(), "cache");
        if (!fs.existsSync(cacheDir))
          fs.mkdirSync(cacheDir, { recursive: true });

        const audioPath = path.join(cacheDir, `${data.video_id}.mp3`);

        console.log(`Downloading audio for ${data.title}...`);
        const cmd = `yt-dlp -x --audio-format mp3 --audio-quality 9 --postprocessor-args "-ar 16000 -ac 1 -b:a 16k" -o "${audioPath}" "${data.video_url}"`;
        await execPromise(cmd);

        console.log(`Uploading audio for ${data.title}...`);
        const fileBuffer = fs.readFileSync(audioPath);
        const storageRef = ref(storage, `audio_cache/${data.video_id}.mp3`);
        await uploadBytes(storageRef, new Uint8Array(fileBuffer));
        const audioUrl = await getDownloadURL(storageRef);

        fs.unlinkSync(audioPath);

        await updateDoc(docRef, {
          status: "PENDING_ANALYSIS",
          audio_url: audioUrl,
        });
        console.log(`Audio uploaded for ${data.title}`);
      } catch (error) {
        console.error(`Download failed for ${data.title}:`, error);
        const newRetries = (data.retries || 0) + 1;
        if (newRetries >= 3) {
          await updateDoc(docRef, { status: "FAILED", retries: newRetries });
          const emailsStr = process.env.CRON_EMAILS || "r76021061@gmail.com";
          const emails = emailsStr.split(",").map((e) => e.trim());
          await sendSummaryEmail(
            emails,
            `[財經 AI 警告] 影片下載失敗: ${data.title}`,
            `影片 ${data.title} 連續下載失敗 3 次，請檢查系統或 Object Storage。`,
          );
        } else {
          await updateDoc(docRef, {
            status: "PENDING_DOWNLOAD",
            retries: newRetries,
          });
        }
      }
    }
  } finally {
    isDownloading = false;
  }
}

let isAnalyzing = false;
async function processPendingAnalysis() {
  if (!db || !storage || isAnalyzing) return;
  isAnalyzing = true;
  try {
    const q = query(
      collection(db, "video_summaries"),
      where("status", "==", "PENDING_ANALYSIS"),
    );
    const querySnapshot = await getDocs(q);

    for (const document of querySnapshot.docs) {
      const data = document.data();
      const docRef = doc(db, "video_summaries", document.id);

      try {
        await updateDoc(docRef, { status: "ANALYZING" });
        console.log(`Analyzing audio for ${data.title}...`);

        const response = await fetch(data.audio_url);
        const arrayBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY not found");
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `你是一個專業的財經分析師。請幫我總結這段 ${data.channel_name || "財經"} 的 YouTube 影片音檔。
請用繁體中文，詳細整理出以下重點：
1. 本集核心主題
2. 市場趨勢與總經分析
3. 提到的個股或產業重點
4. 講者的個人觀點與結論`;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              inlineData: {
                mimeType: "audio/mp3",
                data: base64Audio,
              },
            },
            prompt,
          ],
        });

        const summaryText = aiResponse.text || "無法生成摘要";

        await updateDoc(docRef, {
          status: "COMPLETED",
          summary: summaryText,
          analyzed_at: new Date().toISOString(),
        });
        console.log(`Analysis completed for ${data.title}`);

        const emailsStr = process.env.CRON_EMAILS || "r76021061@gmail.com";
        const emails = emailsStr.split(",").map((e) => e.trim());
        const body = `
## 最新影片上架通知

**${data.channel_name}** 剛剛發布了最新影片：

### [${data.title}](${data.video_url})

---

## 🤖 AI 重點摘要

${summaryText}

---

[👉 前往網站查看更多資訊](https://ais-pre-gbf6utyng3ppivgpw645hj-192441689969.asia-northeast1.run.app)
        `;
        await sendSummaryEmail(
          emails,
          `[財經 AI] 新片上架：${data.title}`,
          body,
        );
      } catch (error) {
        console.error(`Analysis failed for ${data.title}:`, error);
        await updateDoc(docRef, { status: "PENDING_ANALYSIS" });
      }
    }
  } finally {
    isAnalyzing = false;
  }
}

// Setup Cron Job
function setupCronJob() {
  // Run every 30 minutes
  cron.schedule(
    "*/30 * * * *",
    async () => {
      try {
        console.log(
          "Running scheduled video check for all channels (every 30 mins)...",
        );
        for (const channel of CHANNELS) {
          await processChannel(channel);
          // Add a small delay (5 seconds) between requests to avoid hitting YouTube too fast
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        console.log("Processing pending downloads...");
        await processPendingDownloads();

        console.log("Processing pending analysis...");
        await processPendingAnalysis();
      } catch (error) {
        console.error("Error in cron job execution:", error);
      }
    },
    { timezone: "Asia/Taipei" },
  );

  console.log("Internal cron job scheduled to run every 30 minutes.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      prefix: process.env.GEMINI_API_KEY?.substring(0, 5),
    });
  });

  // API Route: Get Runtime Config (for Docker/K8s deployments where env vars are injected at runtime)
  app.get("/api/config", (req, res) => {
    res.json({ geminiApiKey: process.env.GEMINI_API_KEY });
  });

  // API Route: Trigger Cron Job Manually (for K8s CronJob)
  app.post("/api/trigger-cron", async (req, res) => {
    const { channelId } = req.body;

    if (!channelId) {
      return res
        .status(400)
        .json({ error: "Missing channelId in request body" });
    }

    const channel = CHANNELS.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Run in background
    processChannel(channel);

    res.json({
      success: true,
      message: `Cron job triggered for ${channel.name}`,
    });
  });

  // API Route: Fetch Recent Videos
  app.get("/api/recent-videos", (req, res) => {
    const channelHandle = req.query.channel || "@Gooaye";
    const type = req.query.type || "videos";
    const tabName = type === "streams" ? "streams" : "videos";

    const request = https
      .get(`https://www.youtube.com/${channelHandle}/${tabName}`, (ytRes) => {
        let data = "";
        ytRes.on("data", (chunk) => {
          data += chunk;
        });
        ytRes.on("end", () => {
          try {
            const match = data.match(
              /var ytInitialData = (\{.*?\});<\/script>/,
            );
            if (match) {
              const json = JSON.parse(match[1]);
              const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
              const videosTab = tabs.find(
                (t: any) =>
                  t.tabRenderer &&
                  t.tabRenderer.content &&
                  t.tabRenderer.content.richGridRenderer,
              );
              const items =
                videosTab.tabRenderer.content.richGridRenderer.contents;

              const videos = items
                .filter(
                  (i: any) =>
                    i.richItemRenderer &&
                    i.richItemRenderer.content &&
                    i.richItemRenderer.content.videoRenderer,
                )
                .map((i: any) => {
                  const v = i.richItemRenderer.content.videoRenderer;
                  return {
                    title: v.title?.runs?.[0]?.text || "Unknown Title",
                    url: "https://www.youtube.com/watch?v=" + v.videoId,
                    date: v.publishedTimeText?.simpleText || "",
                  };
                });

              res.json(videos);
            } else {
              res.status(500).json({ error: "Could not find video data" });
            }
          } catch (e) {
            console.error("Error parsing videos", e);
            res.status(500).json({ error: "Failed to parse videos" });
          }
        });
      })
      .on("error", (e) => {
        console.error("Failed to fetch youtube", e);
        res.status(500).json({ error: "Failed to fetch youtube" });
      });

    // Add a 10-second timeout to the request
    request.setTimeout(10000, () => {
      request.destroy();
      console.error("YouTube fetch timeout");
      res.status(504).json({ error: "YouTube fetch timeout" });
    });
  });

  // API Route: Get Cached Summary or Trigger Processing
  app.get("/api/summary", async (req, res) => {
    const url = req.query.url as string;
    const channelId = (req.query.channelId as string) || "unknown";
    const channelName = (req.query.channelName as string) || "Unknown Channel";

    if (!url) {
      return res.status(400).json({ error: "Missing url parameter" });
    }
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      // Extract video ID from URL
      let videoId = "";
      const vMatch = url.match(/v=([^&]+)/);
      if (vMatch) {
        videoId = vMatch[1];
      } else {
        const shortMatch = url.match(/youtu\.be\/([^?]+)/);
        if (shortMatch) {
          videoId = shortMatch[1];
        } else {
          videoId = encodeURIComponent(url); // Fallback
        }
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
          return res.json({
            summary: "分析失敗，請聯絡管理員。",
            status: "FAILED",
          });
        } else {
          return res.json({
            summary: "資料分析中，請稍後再試...",
            status: docData.status,
          });
        }
      } else {
        // Not found, trigger processing
        const docId = `${channelId}_${videoId}`;
        const docRef = doc(db, "video_summaries", docId);

        await setDoc(docRef, {
          channel_id: channelId,
          channel_name: channelName,
          video_id: videoId,
          video_url: url,
          title: "Requested via Web",
          status: "PENDING_DOWNLOAD",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          download_attempts: 0,
        });

        // Trigger background processing asynchronously
        setTimeout(() => {
          processPendingDownloads()
            .then(() => processPendingAnalysis())
            .catch(console.error);
        }, 1000);

        return res.json({
          summary: "已加入分析排程，資料分析中，請稍後再試...",
          status: "PENDING_DOWNLOAD",
        });
      }
    } catch (error) {
      console.error("Error fetching summary from DB:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // API Route: Check Email Config Status
  app.get("/api/email-status", (req, res) => {
    const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
    const missing = required.filter((key) => !process.env[key]);
    res.json({
      configured: missing.length === 0,
      missing: missing,
    });
  });

  // API Route: Send Email
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if SMTP is configured
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      return res.status(500).json({
        error:
          "Email service is not configured. Please set SMTP environment variables.",
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const parsedHtml = await marked.parse(body);

      const emailTemplate = `
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
        html: emailTemplate,
      });

      res.json({ success: true, message: "Email sent successfully" });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Global error handler for URIError (malicious scans)
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err instanceof URIError) {
        console.warn(
          `[Security] Caught URIError from ${req.ip}: ${req.originalUrl}`,
        );
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
