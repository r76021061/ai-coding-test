import { GoogleGenAI } from "@google/genai";

/**
 * Step 1 — Transcription
 * Sends the audio file to Gemini and asks for a verbatim transcript
 * in Traditional Chinese. Storing the transcript allows:
 *   - Human review / quality check
 *   - Re-analysis with different prompts without re-downloading audio
 *   - Cheaper future AI calls (text tokens << audio tokens)
 */
export async function transcribeAudio(
  audioUrl: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable not set");

  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download audio: ${response.status} ${response.statusText}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");

  const ai = new GoogleGenAI({ apiKey });

  const aiResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: [
      {
        inlineData: {
          mimeType: "audio/mp3",
          data: base64Audio,
        },
      },
      "請將這段音檔完整轉錄為繁體中文逐字稿。保留所有細節，不要摘要或省略任何內容。如果有任何英文或數字，請如實保留。",
    ],
  });

  return aiResponse.text || "";
}

/**
 * Step 2 — Financial Analysis
 * Takes the stored transcript text (plain text, no audio needed) and
 * generates a structured financial summary in Traditional Chinese.
 * This can be re-run cheaply at any time without re-downloading audio.
 */
export async function analyzeTranscript(
  transcript: string,
  channelName: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable not set");

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `你是一個專業的財經分析師。以下是「${channelName || "財經頻道"}」YouTube 影片的逐字稿，請用繁體中文詳細整理出以下重點：

1. 本集核心主題
2. 市場趨勢與總經分析
3. 提到的個股或產業重點
4. 講者的個人觀點與結論

---逐字稿開始---
${transcript}
---逐字稿結束---`;

  const aiResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: [prompt],
  });

  return aiResponse.text || "無法生成摘要";
}
