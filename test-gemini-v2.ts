import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 60000,
    },
  });
}

async function testGemini() {
    console.log("Starting minimal Gemini test...");
    const ai = getGeminiClient();
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: "Reply with exactly: Yes, I am Opti.",
        });
        console.log("Test success:", response.text);
    } catch (error: any) {
        console.error("Test error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status,
            cause: error?.cause?.message,
        });
    }
}

testGemini();
