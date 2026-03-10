import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";

export const fetchRecentVideos = async (channelName: string, offset: number = 0, count: number = 5) => {
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `請搜尋『${channelName}』YouTube 頻道最新的 ${offset + count} 部影片。
  請回傳第 ${offset + 1} 到第 ${offset + count} 部影片的資訊，按發布日期從【最新到最舊】排序。
  請以 JSON 格式回覆一個陣列，每個物件包含：
  - title: 影片標題
  - url: 影片完整連結
  - date: 發布日期 (格式為 YYYY-MM-DD)`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      // Lower temperature for faster, more deterministic output
      temperature: 0.2,
    },
  });

  try {
    const text = response.text || "[]";
    return JSON.parse(text) as { title: string; url: string; date?: string }[];
  } catch (e) {
    console.error("Failed to parse videos JSON:", e);
    return [];
  }
};

export const summarizeVideo = async (channelName: string, videoUrl: string) => {
  if (!videoUrl) {
    return { text: "請提供影片連結。", sources: [] };
  }

  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl, channelName }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to summarize video");
    }

    const data = await response.json();
    return {
      text: data.text,
      sources: [] // We don't have grounding sources anymore since we use transcript
    };
  } catch (error: any) {
    console.error("Error calling summarize API:", error);
    throw error;
  }
};
