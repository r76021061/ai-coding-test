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
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

dotenv.config();

// Supported Channels
const CHANNELS = [
  { id: 'gooaye_videos', handle: '@Gooaye', type: 'videos', name: '股癌 Gooaye (影片)' },
  { id: 'yutinghao_streams', handle: '@yutinghaofinance', type: 'streams', name: '游庭皓的財經皓角 (直播)' },
  { id: 's178_videos', handle: '@s178', type: 'videos', name: '郭哲榮分析師-摩爾證券投顧 (影片)' },
  { id: 's178_streams', handle: '@s178', type: 'streams', name: '郭哲榮分析師-摩爾證券投顧 (直播)' }
];

let db: any;

async function initDB() {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      console.log("Firebase initialized.");
    } else {
      console.warn("firebase-applet-config.json not found. Firebase will not be initialized.");
    }
  } catch (error) {
    console.error("Firebase init error:", error);
  }
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

    // Check if we already processed this video in Firestore
    if (!db) {
      console.warn("DB not initialized, skipping check");
      return;
    }
    
    const docId = `${channel.id}_${latestVideo.videoId}`;
    const docRef = doc(db, "processed_videos", docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      console.log(`Latest video already processed for ${channel.name}:`, latestVideo.title);
      return;
    }

    console.log(`New video found for ${channel.name}:`, latestVideo.title);

    // 3. Send Email (Notification only, since Gemini API cannot be called from backend)
    const emailsStr = process.env.CRON_EMAILS || "r76021061@gmail.com";
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
    await setDoc(docRef, {
      channel_id: channel.id,
      video_id: latestVideo.videoId,
      processed_at: new Date().toISOString()
    });
    console.log(`Cron job completed successfully for ${channel.name}.`);

  } catch (error) {
    console.error(`Error in processing channel ${channel.name}:`, error);
  }
}

// Setup Cron Job
function setupCronJob() {
  // Run every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    console.log("Running scheduled video check for all channels (every 30 mins)...");
    for (const channel of CHANNELS) {
      await processChannel(channel);
      // Add a small delay (5 seconds) between requests to avoid hitting YouTube too fast
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }, { timezone: "Asia/Taipei" });

  console.log("Internal cron job scheduled to run every 30 minutes.");
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
    
    const request = https.get(`https://www.youtube.com/${channelHandle}/${tabName}`, (ytRes) => {
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
    
    // Add a 10-second timeout to the request
    request.setTimeout(10000, () => {
      request.destroy();
      console.error("YouTube fetch timeout");
      res.status(504).json({ error: "YouTube fetch timeout" });
    });
  });
  
  // API Route: Get Cached Summary
  app.get("/api/summary", async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: "Missing url parameter" });
    }
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      const docId = encodeURIComponent(url);
      const docRef = doc(db, "video_summaries", docId);
      
      const getDocPromise = getDoc(docRef);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Database fetch timeout")), 5000)
      );
      
      const docSnap = await Promise.race([getDocPromise, timeoutPromise]) as any;
      
      if (docSnap.exists()) {
        res.json({ summary: docSnap.data().summary });
      } else {
        res.status(404).json({ error: "Summary not found" });
      }
    } catch (error) {
      console.error("Error fetching summary from DB:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // API Route: Save Summary to Cache
  app.post("/api/summary", async (req, res) => {
    const { url, summary } = req.body;
    if (!url || !summary) {
      return res.status(400).json({ error: "Missing url or summary" });
    }
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      const docId = encodeURIComponent(url);
      const docRef = doc(db, "video_summaries", docId);
      
      const setDocPromise = setDoc(docRef, {
        video_url: url,
        summary: summary,
        created_at: new Date().toISOString()
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Database write timeout")), 5000)
      );
      
      await Promise.race([setDocPromise, timeoutPromise]);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving summary to DB:", error);
      res.status(500).json({ error: "Database error" });
    }
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
      // Add a 10-second timeout to prevent hanging
      const fetchPromise = YoutubeTranscript.fetchTranscript(videoUrl, { lang: 'zh-TW' })
        .catch(() => YoutubeTranscript.fetchTranscript(videoUrl));
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Transcript fetch timeout")), 10000)
      );

      const transcriptItems = await Promise.race([fetchPromise, timeoutPromise]) as any[];
      const fullText = transcriptItems.map(item => item.text).join(' ');
      res.json({ text: fullText });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      const isExpectedError = 
        errorMessage.includes('Transcript is disabled') || 
        errorMessage.includes('No transcripts') ||
        errorMessage.includes('Video is unavailable') ||
        errorMessage.includes('Could not find transcripts');
        
      if (isExpectedError) {
        console.warn(`[Info] Transcript is not available for video: ${videoUrl}. Falling back to search. Reason: ${errorMessage}`);
        return res.status(404).json({ error: "Transcript not available", details: errorMessage });
      }
      
      console.error("Error fetching transcript:", error);
      res.status(500).json({ error: "Failed to fetch transcript.", details: errorMessage });
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
