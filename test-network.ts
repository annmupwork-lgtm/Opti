import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function testNetwork() {
    console.log("Starting network connectivity test...");
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash";
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY || ""
            }
        });
        console.log("Connectivity status:", response.status);
        console.log("Headers:", Object.fromEntries(response.headers.entries()));
    } catch (error) {
        console.error("Connectivity test error:", error);
    }
}

async function testGeminiAuth() {
    console.log("Starting API authentication test...");
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
    });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: "Reply with exactly: Yes, I am Opti.",
        });
        console.log("Test success:", response.text);
    } catch (error) {
        console.error("Authentication test error:", error);
    }
}

testNetwork().then(testGeminiAuth);
