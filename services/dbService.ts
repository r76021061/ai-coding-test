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
  runTransaction,
  Firestore,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, FirebaseStorage } from "firebase/storage";
import { exec } from "child_process";
import util from "util";
import fs from "fs";
import path from "path";
import { fetchLatestVideo } from "./youtubeService";
import { transcribeAudio, analyzeTranscript } from "./aiService";
import { sendSummaryEmail, getCronEmails } from "./emailService";

const execPromise = util.promisify(exec);

export interface Channel {
  id: string;
  handle: string;
  type: string;
  name: string;
}

// Module-level singletons — initialized once by initDB()
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

/** Initialize Firebase. Safe to call multiple times (no-op if already initialized). */
export async function initDB(): Promise<void> {
  if (db) return; // already initialized
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      console.warn(
        "firebase-applet-config.json not found. Firebase will not be initialized.",
      );
      return;
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    storage = getStorage(firebaseApp);
    console.log("Firebase initialized.");
  } catch (error) {
    console.error("Firebase init error:", error);
  }
}

export function getDB(): Firestore | null {
  return db;
}

export function getStorageInstance(): FirebaseStorage | null {
  return storage;
}

// ---------------------------------------------------------------------------
// State Machine: Detect new videos → write PENDING_DOWNLOAD to Firestore
// ---------------------------------------------------------------------------

/**
 * Checks if the channel has a new video. If so, creates a new Firestore
 * document with status PENDING_DOWNLOAD. Idempotent — skips if doc exists.
 */
export async function processChannel(channel: Channel): Promise<void> {
  if (!db) {
    console.warn("DB not initialized, skipping processChannel");
    return;
  }

  try {
    const latestVideo = await fetchLatestVideo(channel.handle, channel.type);
    if (!latestVideo) {
      console.log(`Could not fetch latest video for ${channel.name}.`);
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
    console.error(`Error processing channel ${channel.name}:`, error);
  }
}

// ---------------------------------------------------------------------------
// State Machine: PENDING_DOWNLOAD → DOWNLOADING → PENDING_ANALYSIS
// Uses Firestore runTransaction to claim a task atomically, making it safe
// for multiple concurrent replicas (Cloud Run / Kubernetes).
// ---------------------------------------------------------------------------

export async function processPendingDownloads(): Promise<void> {
  if (!db || !storage) return;

  const q = query(
    collection(db, "video_summaries"),
    where("status", "==", "PENDING_DOWNLOAD"),
  );
  const querySnapshot = await getDocs(q);

  for (const document of querySnapshot.docs) {
    const docRef = doc(db, "video_summaries", document.id);

    // --- Atomic claim via Transaction ---
    // Only one replica can transition PENDING_DOWNLOAD → DOWNLOADING.
    // If another replica already claimed it, skip silently.
    let claimed = false;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.data()?.status !== "PENDING_DOWNLOAD") {
          // Already claimed by another replica — abort without throwing
          return;
        }
        tx.update(docRef, { status: "DOWNLOADING" });
        claimed = true;
      });
    } catch (txError) {
      console.error(
        `Transaction failed for ${document.id}, skipping:`,
        txError,
      );
      continue;
    }

    if (!claimed) continue;

    // --- Proceed with the actual work ---
    const data = document.data();
    try {
      const cacheDir = path.join(process.cwd(), "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      const audioPath = path.join(cacheDir, `${data.video_id}.mp3`);

      console.log(`Downloading audio for "${data.title}"...`);
      // --max-filesize 100m prevents runaway huge files from eating memory
      const cmd = [
        "yt-dlp",
        "-x",
        "--audio-format mp3",
        "--audio-quality 9",
        '--postprocessor-args "-ar 16000 -ac 1 -b:a 16k"',
        "--max-filesize 100m",
        `-o "${audioPath}"`,
        `"${data.video_url}"`,
      ].join(" ");
      await execPromise(cmd);

      console.log(`Uploading audio for "${data.title}"...`);
      const fileBuffer = fs.readFileSync(audioPath);
      const storageRef = ref(storage, `audio_cache/${data.video_id}.mp3`);
      await uploadBytes(storageRef, new Uint8Array(fileBuffer));
      const audioUrl = await getDownloadURL(storageRef);

      // Clean up local temp file immediately to free disk space
      fs.unlinkSync(audioPath);

      await updateDoc(docRef, {
        status: "PENDING_ANALYSIS",
        audio_url: audioUrl,
        updated_at: new Date().toISOString(),
      });
      console.log(`Audio uploaded for "${data.title}"`);
    } catch (error) {
      console.error(`Download failed for "${data.title}":`, error);

      const freshSnap = await getDoc(docRef);
      const currentRetries = freshSnap.data()?.retries ?? 0;
      const newRetries = currentRetries + 1;

      if (newRetries >= 3) {
        await updateDoc(docRef, {
          status: "FAILED",
          retries: newRetries,
          updated_at: new Date().toISOString(),
        });
        const emails = getCronEmails();
        if (emails.length > 0) {
          await sendSummaryEmail(
            emails,
            `[財經 AI 警告] 影片下載失敗: ${data.title}`,
            `影片 **${data.title}** 連續下載失敗 ${newRetries} 次，請檢查系統或 Object Storage。`,
          );
        }
      } else {
        await updateDoc(docRef, {
          status: "PENDING_DOWNLOAD",
          retries: newRetries,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// State Machine: PENDING_ANALYSIS → ANALYZING → COMPLETED
// Same Transaction-based claim pattern as processPendingDownloads.
// ---------------------------------------------------------------------------

export async function processPendingAnalysis(): Promise<void> {
  if (!db) return;

  const q = query(
    collection(db, "video_summaries"),
    where("status", "==", "PENDING_ANALYSIS"),
  );
  const querySnapshot = await getDocs(q);

  for (const document of querySnapshot.docs) {
    const docRef = doc(db, "video_summaries", document.id);

    // --- Atomic claim via Transaction ---
    let claimed = false;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.data()?.status !== "PENDING_ANALYSIS") {
          return;
        }
        tx.update(docRef, { status: "ANALYZING" });
        claimed = true;
      });
    } catch (txError) {
      console.error(
        `Transaction failed for ${document.id}, skipping:`,
        txError,
      );
      continue;
    }

    if (!claimed) continue;

    const data = document.data();
    try {
      // Step 1: Transcribe audio → store verbatim transcript
      console.log(`Transcribing audio for "${data.title}"...`);
      const transcript = await transcribeAudio(data.audio_url);

      await updateDoc(docRef, {
        transcript,
        transcribed_at: new Date().toISOString(),
      });
      console.log(`Transcript saved for "${data.title}" (${transcript.length} chars)`);

      // Step 2: Analyze transcript text → store financial summary
      console.log(`Analyzing transcript for "${data.title}"...`);
      const summaryText = await analyzeTranscript(transcript, data.channel_name);

      await updateDoc(docRef, {
        status: "COMPLETED",
        summary: summaryText,
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      console.log(`Analysis completed for "${data.title}"`);

      const emails = getCronEmails();
      if (emails.length > 0) {
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
      }
    } catch (error) {
      console.error(`Analysis failed for "${data.title}":`, error);
      // Roll back to PENDING_ANALYSIS so the next cron cycle will retry
      await updateDoc(docRef, {
        status: "PENDING_ANALYSIS",
        updated_at: new Date().toISOString(),
      });
    }
  }
}
