import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import https from "https";
import { marked } from "marked";
import cron from "node-cron";
import { YoutubeTranscript } from "youtube-transcript";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Supported Channels
const CHANNELS = [
  { id: "@Gooaye", name: "股癌 Gooaye" },
  { id: "@yutinghaofinance", name: "游庭皓的財經皓角" }
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
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: to.join(", "),
    subject,
    text: body,
    html: emailTemplate,
  });
}

// Helper to fetch latest video
function fetchLatestVideo(channelId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const tabName = channelId === '@yutinghaofinance' ? 'streams' : 'videos';
    https.get(`https://www.youtube.com/${channelId}/${tabName}`, (ytRes) => {
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
async function processChannel(channel: { id: string, name: string }) {
  try {
    const latestVideo = await fetchLatestVideo(channel.id);
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

    // 1. Fetch Transcript
    const transcriptItems = await YoutubeTranscript.fetchTranscript(latestVideo.url, { lang: 'zh-TW' })
      .catch(() => YoutubeTranscript.fetchTranscript(latestVideo.url));
    
    const fullText = transcriptItems.map(item => item.text).join(' ');

    // 2. Summarize
    const prompt = `你是一個專業的財經分析師。請幫我總結以下 ${channel.name} 的 YouTube 影片逐字稿。
請用繁體中文，整理出以下重點：
1. 本集核心主題
2. 市場趨勢與總經分析
3. 提到的個股或產業重點
4. 講者的個人觀點與結論

逐字稿內容：
${fullText.substring(0, 30000)}`; // Limit length to avoid token limits

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const summary = response.text || "無法生成摘要";

    // 3. Send Email
    const emailsStr = process.env.CRON_EMAILS || "r76021061@gmail.com";
    const emails = emailsStr.split(",").map(e => e.trim());
    
    await sendSummaryEmail(
      emails,
      `[財經 AI] 最新總結：${latestVideo.title}`,
      summary
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
    const channel = CHANNELS.find(c => c.id === '@Gooaye');
    if (channel) await processChannel(channel);
  }, { timezone: "Asia/Taipei" });

  // For Yutinghao: Run every day at 08:30 AM
  cron.schedule("30 8 * * *", async () => {
    console.log("Running daily video check for Yutinghao...");
    const channel = CHANNELS.find(c => c.id === '@yutinghaofinance');
    if (channel) await processChannel(channel);
  }, { timezone: "Asia/Taipei" });

  console.log("Internal cron jobs scheduled for 21:00 and 08:30 Asia/Taipei");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  
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
    const channelId = req.query.channel || '@Gooaye';
    const tabName = channelId === '@yutinghaofinance' ? 'streams' : 'videos';
    https.get(`https://www.youtube.com/${channelId}/${tabName}`, (ytRes) => {
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

  // API Route: Summarize Video
  app.post("/api/summarize", async (req, res) => {
    const { videoUrl, channelName } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ error: "Missing videoUrl" });
    }

    try {
      // 1. Fetch Transcript
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: 'zh-TW' })
        .catch(() => YoutubeTranscript.fetchTranscript(videoUrl));
      
      const fullText = transcriptItems.map(item => item.text).join(' ');

      // 2. Summarize
      const prompt = `你是一個專業的財經分析師。請幫我總結以下 ${channelName || '財經'} 的 YouTube 影片逐字稿。
請用繁體中文，整理出以下重點：
1. 本集核心主題
2. 市場趨勢與總經分析
3. 提到的個股或產業重點
4. 講者的個人觀點與結論

逐字稿內容：
${fullText.substring(0, 30000)}`; // Limit length to avoid token limits

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      res.json({ text: response.text || "無法生成摘要" });
    } catch (error) {
      console.error("Error summarizing video:", error);
      res.status(500).json({ error: "Failed to summarize video. It might not have a transcript yet." });
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
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
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
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    await initDB();
    console.log(`Server running on http://localhost:${PORT}`);
    setupCronJob();
  });
}

startServer();
