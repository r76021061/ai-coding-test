import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "What is the exact YouTube channel handle (the part after @) for '游庭皓的財經皓角'?",
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  console.log(response.text);
}

main();
