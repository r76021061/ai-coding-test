import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import https from "https";
import { marked } from "marked";
import cron from "node-cron";
import { YoutubeTranscript } from "youtube-transcript";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

dotenv.config();

// Supported Channels
const CHANNELS = [
  { id: 'gooaye_videos', handle: '@Gooaye', type: 'videos', name: '股癌 Gooaye (影片)' },
  { id: 'yutinghao_streams', handle: '@yutinghaofinance', type: 'streams', name: '游庭皓的財經皓角 (直播)' },
  { id: 's178_videos', handle: '@s178', type: 'videos', name: '郭哲榮分析師-摩爾證券投顧 (影片)' },
  { id: 's178_streams', handle: '@s178', type: 'streams', name: '郭哲榮分析師-摩爾證券投顧 (直播)' }
];

let db: Database;

async function initDB() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "database.sqlite");
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS processed_videos (
      channel_id TEXT,
      video_id TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, video_id)
    )
  `);
  console.log(`Database initialized at ${dbPath}`);
}

// Helper to send email
async function sendSummaryEmail(to: string[], subject: string, body: string) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
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
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
        <h2 style="color: #0f172a; margin: 0; font-size: 24px;">Gooaye AI</h2>
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
    to: to.join(", "),
    subject,
    text: body,
    html: emailTemplate,
  });
}

// Helper to fetch latest video
function fetchLatestVideo(channelHandle: string, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const tabName = type === 'streams' ? 'streams' : 'videos';
    https.get(`https://www.youtube.com/${channelHandle}/${tabName}`, (ytRes) => {
      let data = '';
      ytRes.on('data', (chunk) => data += chunk);
      ytRes.on('end', () => {
        try {
          const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/);
          if (match) {
            const json = JSON.parse(match[1]);
            const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
            const videosTab = tabs.find((t: any) => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.richGridRenderer);
            const items = videosTab.tabRenderer.content.richGridRenderer.contents;
            const latestItem = items.find((i: any) => i.richItemRenderer);
            
            if (latestItem) {
              const v = latestItem.richItemRenderer.content.videoRenderer;
              resolve({
                title: v.title.runs[0].text,
                videoId: v.videoId,
                url: 'https://www.youtube.com/watch?v=' + v.videoId,
                date: v.publishedTimeText?.simpleText
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
    }).on('error', reject);
  });
}

// Logic to process a single channel
async function processChannel(channel: { id: string, handle: string, type: string, name: string }) {
  try {
    const latestVideo = await fetchLatestVideo(channel.handle, channel.type);
    if (!latestVideo) {
      console.log(`Could not fetch latest video for ${channel.name}.`);
      return;
    }

    // Check if we already processed this video in SQLite
    const row = await db.get(
      "SELECT video_id FROM processed_videos WHERE channel_id = ? AND video_id = ?",
      [channel.id, latestVideo.videoId]
    );

    if (row) {
      console.log(`Latest video already processed for ${channel.name}:`, latestVideo.title);
      return;
    }

    console.log(`New video found for ${channel.name}:`, latestVideo.title);

    // 3. Send Email (Notification only, since Gemini API cannot be called from backend)
    const emailsStr = process.env.CRON_EMAILS || "r76021061@gmail.com,rose.huang@gmail.com";
    const emails = emailsStr.split(",").map(e => e.trim());
    
    const body = `
## 最新影片上架通知

**${channel.name}** 剛剛發布了最新影片：

### [${latestVideo.title}](${latestVideo.url})

> 💡 **溫馨提示：** 
> 由於平台安全性限制，AI 摘要功能必須在您的瀏覽器中執行。
> 請點擊下方連結前往「財經 AI 秘書 2.0」網站，系統將自動為您生成這集影片的重點摘要！

[👉 前往網站生成 AI 摘要](https://ais-pre-gbf6utyng3ppivgpw645hj-192441689969.asia-northeast1.run.app)
    `;

    await sendSummaryEmail(
      emails,
      `[財經 AI] 新片上架：${latestVideo.title}`,
      body
    );

    // 4. Save state to DB
    await db.run(
      "INSERT INTO processed_videos (channel_id, video_id) VALUES (?, ?)",
      [channel.id, latestVideo.videoId]
    );
    console.log(`Cron job completed successfully for ${channel.name}.`);

  } catch (error) {
    console.error(`Error in processing channel ${channel.name}:`, error);
  }
}

// Setup Cron Job
function setupCronJob() {
  // We can keep the internal cron jobs as a fallback or remove them if K8s is preferred.
  // For Gooaye: Run every day at 21:00 (9 PM)
  cron.schedule("0 21 * * *", async () => {
    console.log("Running daily video check for Gooaye...");
    const channel = CHANNELS.find(c => c.id === 'gooaye_videos');
    if (channel) await processChannel(channel);
  }, { timezone: "Asia/Taipei" });

  // For Yutinghao: Run every day at 08:30 AM
  cron.schedule("30 8 * * *", async () => {
    console.log("Running daily video check for Yutinghao...");
    const channel = CHANNELS.find(c => c.id === 'yutinghao_streams');
    if (channel) await processChannel(channel);
  }, { timezone: "Asia/Taipei" });

  // For Guo Zhe-Rong: Run every day at 18:00
  cron.schedule("0 18 * * *", async () => {
    console.log("Running daily video check for Guo Zhe-Rong...");
    const channelV = CHANNELS.find(c => c.id === 's178_videos');
    if (channelV) await processChannel(channelV);
    const channelS = CHANNELS.find(c => c.id === 's178_streams');
    if (channelS) await processChannel(channelS);
  }, { timezone: "Asia/Taipei" });

  console.log("Internal cron jobs scheduled for 21:00, 08:30, and 18:00 Asia/Taipei");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", hasGeminiKey: !!process.env.GEMINI_API_KEY, prefix: process.env.GEMINI_API_KEY?.substring(0, 5) });
  });

  // API Route: Get Runtime Config (for Docker/K8s deployments where env vars are injected at runtime)
  app.get("/api/config", (req, res) => {
    res.json({ geminiApiKey: process.env.GEMINI_API_KEY });
  });

  // API Route: Trigger Cron Job Manually (for K8s CronJob)
  app.post("/api/trigger-cron", async (req, res) => {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId in request body" });
    }

    const channel = CHANNELS.find(c => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Run in background
    processChannel(channel);
    
    res.json({ success: true, message: `Cron job triggered for ${channel.name}` });
  });

  // API Route: Fetch Recent Videos
  app.get("/api/recent-videos", (req, res) => {
    const channelHandle = req.query.channel || '@Gooaye';
    const type = req.query.type || 'videos';
    const tabName = type === 'streams' ? 'streams' : 'videos';
    https.get(`https://www.youtube.com/${channelHandle}/${tabName}`, (ytRes) => {
      let data = '';
      ytRes.on('data', (chunk) => {
        data += chunk;
      });
      ytRes.on('end', () => {
        try {
          const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/);
          if (match) {
            const json = JSON.parse(match[1]);
            const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
            const videosTab = tabs.find((t: any) => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.richGridRenderer);
            const items = videosTab.tabRenderer.content.richGridRenderer.contents;
            
            const videos = items.filter((i: any) => i.richItemRenderer).map((i: any) => {
              const v = i.richItemRenderer.content.videoRenderer;
              return {
                title: v.title.runs[0].text,
                url: 'https://www.youtube.com/watch?v=' + v.videoId,
                date: v.publishedTimeText?.simpleText
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
    }).on('error', (e) => {
      console.error("Failed to fetch youtube", e);
      res.status(500).json({ error: "Failed to fetch youtube" });
    });
  });
  
  // API Route: Check Email Config Status
  app.get("/api/email-status", (req, res) => {
    const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
    const missing = required.filter(key => !process.env[key]);
    res.json({ 
      configured: missing.length === 0,
      missing: missing
    });
  });

  // API Route: Fetch Transcript
  app.post("/api/transcript", async (req, res) => {
    const { videoUrl } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ error: "Missing videoUrl" });
    }

    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: 'zh-TW' })
        .catch(() => YoutubeTranscript.fetchTranscript(videoUrl));
      const fullText = transcriptItems.map(item => item.text).join(' ');
      res.json({ text: fullText });
    } catch (error: any) {
      console.error("Error fetching transcript:", error);
      res.status(500).json({ error: "Failed to fetch transcript.", details: error.message || String(error) });
    }
  });

  // API Route: Send Email
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if SMTP is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ 
        error: "Email service is not configured. Please set SMTP environment variables." 
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

  app.listen(PORT, "0.0.0.0", async () => {
    await initDB();
    console.log(`Server running on http://localhost:${PORT}`);
    setupCronJob();
  });
}

startServer();
