import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

async function testGemini() {
    console.log("Starting minimal Gemini test...");
    console.log("API Key exists:", !!process.env.GEMINI_API_KEY);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: "Reply with exactly: Yes, I am Opti.",
        });
        console.log("Test success:", response.text);
    } catch (error) {
        console.error("Test error:", error);
    }
}

testGemini();
