
import { GoogleGenAI } from "@google/genai";
import { slackTools, executeTool } from "./tools.js";
import { App } from "@slack/bolt";

const model = "gemini-3.6-flash";

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

const SYSTEM_INSTRUCTION = `
You are Opti, the AI business partner for Optimal.

Optimal is an AI intelligence company focused on helping users compare, evaluate, and work with AI models.

Your role is to be a highly capable business partner for the Optimal team.

PERSONALITY:
- concise
- analytical
- proactive
- commercially aware
- product-aware
- technically capable
- direct
- honest about uncertainty
- willing to challenge weak assumptions
- action-oriented

BEHAVIOR:
- You receive ALL messages in the #optimal channel, even when users do not mention you.
- Monitor the conversation and decide whether your contribution is useful.
- Respond only if the message is a question, requires analysis, or your expertise is valuable.
- If you should NOT respond, start your message with the word "SILENT". Do not respond otherwise.
- Do not invent facts.
- Distinguish facts from assumptions.
- Use available context before answering.
- Ask a concise clarifying question when necessary.
- Do not pretend to have performed an action you did not perform.
- Do not expose secrets or internal credentials.
- Prefer useful, actionable answers over generic explanations.

SLACK STYLE:
- Write naturally for Slack.
- Keep normal responses concise.
- Use bullets when they improve readability.
- Use threads when responding to threaded conversations.
- Avoid unnecessary verbosity.

Opti is not a generic customer-support bot.
Opti is the internal business partner for the Optimal team.
`;

export async function runAgent(inputItems: any[], deps: { app: App, channelId: string | null, correlationId: string, logDebugEvent: any }) {
    console.log("[OPTI] CALLING GEMINI");
    
    const { correlationId, logDebugEvent } = deps;

    const ai = getGeminiClient();
    const chat = ai.chats.create({
        model: model,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ functionDeclarations: slackTools }],
        }
    });
    console.log("[OPTI] Gemini chat created");

    // Helper for retry logic
    async function sendMessageWithRetry(chat: any, message: any, attempt: number = 1): Promise<any> {
        try {
            return await chat.sendMessage(message);
        } catch (error: any) {
            if (attempt < 2 && error.status === 503) {
                console.warn(`[OPTI] Gemini 503 error on attempt ${attempt}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return sendMessageWithRetry(chat, message, attempt + 1);
            }
            console.error("[OPTI] GEMINI FAILED", {
                name: error?.name,
                message: error?.message,
                status: error?.status,
                cause: error?.cause?.message,
            });
            throw error;
        }
    }

    // Send history
    for (let i = 0; i < inputItems.length - 1; i++) {
        await sendMessageWithRetry(chat, { message: inputItems[i].content });
    }

    let response = await sendMessageWithRetry(chat, { message: inputItems[inputItems.length - 1].content });
    console.log("[OPTI] GEMINI RETURNED", {
        outputLength: response?.text?.length,
        preview: response?.text?.substring(0, 100),
    });
    
    // Simple tool handling loop (max 1 iteration for V1)
    if (response.functionCalls && response.functionCalls.length > 0) {
        console.log("[OPTI] Gemini tool call detected:", response.functionCalls[0].name);
        const call = response.functionCalls[0];
        
        await logDebugEvent({
            correlationId,
            eventType: 'tool_call',
            direction: 'SYSTEM',
            stage: 'Tool execution started',
            status: 'in_progress',
            functionName: call.name,
            functionArgs: call.args
        });

        try {
            const start = Date.now();
            const result = await executeTool(call.name, call.args, deps);
            const duration = Date.now() - start;
            
            await logDebugEvent({
                correlationId,
                eventType: 'tool_result',
                direction: 'SYSTEM',
                stage: 'Tool execution result',
                status: 'ok',
                functionName: call.name,
                toolResult: result,
                latencyMs: duration
            });

            console.log("[OPTI] Tool execution successful");
            response = await sendMessageWithRetry(chat, {
                message: {
                    parts: [{
                        functionResponse: {
                            name: call.name,
                            response: { result },
                        }
                    }]
                } as any
            });
            console.log("[OPTI] Gemini final response received");
        } catch (error: any) {
            console.error("[OPTI] Tool execution error:", error);
            await logDebugEvent({
                correlationId,
                eventType: 'error',
                direction: 'ERROR',
                stage: 'Tool execution',
                status: 'failed',
                functionName: call.name,
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            throw error;
        }
    }

    const text = response.text || "";

    return {
        finalOutput: text,
        history: [...inputItems, { role: 'model', content: text }]
    };
}
