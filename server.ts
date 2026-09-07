import { App, LogLevel } from "@slack/bolt";
import express, { Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleAuth } from 'google-auth-library';
import { getHistory, setHistory } from "./src/thread-context/store.js";
import { runAgent } from "./src/agent/gemini-runner.js";
import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

dotenv.config();

// Initialize Firebase Admin
initializeApp({
  projectId: "gen-lang-client-0899347402"
});
const db = getFirestore(
  getApp(),
  "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7"
);

const debugClients = new Set<Response>();

function broadcastDebugEvent(event: any) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of debugClients) {
    client.write(payload);
  }
}

function emitDebugEvent(event: any) {
    // Ensure timestamp
    if (!event.timestamp) {
        event.timestamp = { seconds: Math.floor(Date.now() / 1000) };
    }
    // Broadcast immediately
    broadcastDebugEvent(event);
    // Persist asynchronously
    logDebugEvent(event).catch(e => console.error("Firestore log failed", e));
}

console.log("[OPTI] FIREBASE PROJECT =", "gen-lang-client-0899347402");
console.log("[OPTI] FIRESTORE DATABASE =", "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7");

// Diagnostic write
(async () => {
    try {
        const testRef = db.collection("debug_events").doc("mirror_test");
        await testRef.set({
            correlationId: "mirror_test",
            eventType: "mirror_test",
            direction: "SYSTEM",
            stage: "Mirror connectivity test",
            status: "ok",
            text: "FIRESTORE_MIRROR_TEST",
            timestamp: FieldValue.serverTimestamp()
        });
        console.log("[OPTI MIRROR TEST] WRITE SUCCESS");
    } catch (e: any) {
        console.error("[OPTI MIRROR TEST] WRITE FAILED", e);
    }
})();


function generateCorrelationId(): string {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
    const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
    const random = Math.random().toString(36).substring(2, 6);
    return `evt_${dateStr}_${timeStr}_${random}`;
}

async function logDebugEvent(event: any) {
  try {
    const correlationId = event.correlationId || "system";
    const ref = db.collection("debug_events").doc();
    
    // Filter undefined values to avoid Firestore document errors
    const cleanedEvent = Object.fromEntries(
      Object.entries(event).filter(([_, v]) => v !== undefined)
    );
    
    await ref.set({
      ...cleanedEvent,
      timestamp: event.timestamp || FieldValue.serverTimestamp(),
      correlationId
    }, { merge: true });
  } catch (error) {
    console.error("LOGGING ERROR: stage=Firestore write", {
        error,
        projectId: "gen-lang-client-0899347402",
        databaseId: "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7"
    });
  }
}

async function logMessageToFirestore(data: any, docId?: string) {
  try {
    const cleanedData = Object.fromEntries(
      Object.entries(data).filter(([_, v]) => v !== undefined)
    );
    
    // Use the Slack ts if provided, otherwise create a new one
    const ref = docId ? db.collection("conversations").doc(docId) : db.collection("conversations").doc();
    
    console.log(`[OPTI DEBUG] Attempting to write to Firestore path: ${ref.path}`);
    
    // Store with the provided data
    await ref.set({
      ...cleanedData,
      // If we are logging a historical message, we should use its original timestamp
      // If it's a new message, we can use serverTimestamp
      timestamp: data.ts ? new Date(parseFloat(data.ts) * 1000) : FieldValue.serverTimestamp(),
    }, { merge: true });
    
    console.log(`[OPTI DEBUG] Write successful for path: ${ref.path}`);
  } catch (error) {
    console.error("Error logging to Firestore:", error);
  }
}

async function populateHistoricalMessages(app: App, channelId: string) {
  try {
    console.log("[OPTI] Populating historical messages...");
    const result = await app.client.conversations.history({ channel: channelId, limit: 50 }); // Fetch last 50
    console.log(`[OPTI] Fetched ${result.messages?.length || 0} messages from Slack.`);
    
    if (result.messages) {
      for (const message of result.messages) {
        if (message.ts) {
            console.log(`[OPTI] Logging message ${message.ts} to Firestore.`);
            await logMessageToFirestore({
                type: 'message',
                channel: channelId,
                user: message.user,
                text: message.text,
                subtype: message.subtype,
                ts: message.ts
            }, message.ts);
        }
      }
      console.log("[OPTI] Historical messages population complete.");
    }
  } catch (error) {
    console.error("Error populating historical messages:", error);
  }
}

const app = express();
const PORT = 3000;

// Slack Bolt App
let slackApp: App | null = null;
let optimalChannelId: string | null = null;
const processedEvents = new Set<string>();

async function fetchOptimalChannelId(app: App) {
  try {
    const result = await app.client.conversations.list({
      types: 'public_channel',
    });
    const channel = result.channels?.find(c => c.name === 'optimal');
    if (channel) {
      console.log(`Found #optimal channel ID: ${channel.id}`);
      return channel.id!;
    }
    console.warn("Could not find #optimal channel");
  } catch (error) {
    console.error("Error fetching channels:", error);
  }
  return null;
}

function initSlackApp() {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
    console.warn("Slack tokens missing. Slack features will be disabled.");
    return null;
  }
  
  console.log(`[OPTI DIAGNOSTIC] SLACK_BOT_TOKEN starts with: ${process.env.SLACK_BOT_TOKEN.substring(0, 4)}`);
  console.log(`[OPTI DIAGNOSTIC] SLACK_APP_TOKEN starts with: ${process.env.SLACK_APP_TOKEN.substring(0, 4)}`);

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Basic listener
  app.message(async ({ message, say }) => {
      const correlationId = generateCorrelationId();
      const channelId = message.channel;
      const ts = (message as any).ts;
      const text = (message as any).text;
      const userId = (message as any).user;
      const threadTs = (message as any).thread_ts;

      emitDebugEvent({
        correlationId,
        eventType: 'slack_message',
        direction: 'SLACK → OPTI',
        stage: 'Received Slack message',
        status: 'ok',
        channelId,
        channelName: 'optimal',
        slackMessageTs: ts,
        threadTs,
        userId,
        text
      });

      emitDebugEvent({
        correlationId,
        eventType: 'processing',
        direction: 'SYSTEM',
        stage: 'Opti processing started',
        status: 'in_progress',
        channelId
      });

      console.log("[OPTI TEST] EVENT RECEIVED");
      
      // Update the mirror
      logMessageToFirestore({
        type: 'message',
        channel: channelId,
        user: userId,
        text: text,
        ts: ts
      }, ts);

      console.log("[OPTI TEST] EVENT TYPE = message");
      console.log("[OPTI TEST] CHANNEL =", channelId);
      
      // Opti V1: Basic conversational brain
      // (Ignoring subtypes for now, handling DMs and channel messages)
      if (message.subtype === 'message_changed' || message.subtype === 'message_deleted' || message.subtype === 'bot_message' || (message as any).bot_id) return;
      
      // Constraint: Strictly limit to #optimal
      if (channelId !== optimalChannelId) {
          return;
      }
      
      console.log("[OPTI TEST] EVENT TS =", ts);
      if (processedEvents.has(ts)) {
        return;
      }
      processedEvents.add(ts);
      setTimeout(() => processedEvents.delete(ts), 10000);
      
      const history = getHistory(channelId, threadTs || ts);
      const cleanedText = text || "";
      
      const inputItems = history.length > 0 
        ? [...history, { role: 'user', content: cleanedText }]
        : [{ role: 'user', content: cleanedText }];
      
      try {
        console.log("[OPTI TEST] RUN_AGENT START");
        
        await logDebugEvent({
            correlationId,
            eventType: 'gemini_request',
            direction: 'SYSTEM',
            stage: 'Gemini request started',
            status: 'in_progress',
            channelId,
            raw: { inputItems }
        });

        const startTime = Date.now();
        const { finalOutput, history: newHistory } = await runAgent(inputItems, { app, channelId: optimalChannelId, correlationId, logDebugEvent });
        setHistory(channelId, threadTs || ts, newHistory);
        
        const latencyMs = Date.now() - startTime;
        
        if (finalOutput.startsWith("SILENT")) {
            await logDebugEvent({
                correlationId,
                eventType: 'decision',
                direction: 'OPTI',
                stage: 'Opti decided to remain silent',
                status: 'ok',
                decision: 'silent',
                channelId
            });
        } else {
            await logDebugEvent({
                correlationId,
                eventType: 'decision',
                direction: 'OPTI',
                stage: 'Opti decided to respond',
                status: 'ok',
                decision: 'respond',
                channelId
            });

            console.log("[OPTI TEST] SLACK SEND START");
            
            await logDebugEvent({
              correlationId,
              eventType: 'slack_send',
              direction: 'OPTI → SLACK',
              stage: 'Outbound Slack message',
              status: 'in_progress',
              channelId,
              text: finalOutput
            });
            
            const reply: any = { text: finalOutput };
            if (threadTs) reply.thread_ts = threadTs;
            const result = await say(reply);
            
            await logDebugEvent({
              correlationId,
              eventType: 'slack_send',
              direction: 'OPTI → SLACK',
              stage: 'Outbound Slack message',
              status: 'ok',
              channelId,
              text: finalOutput,
              raw: result
            });
            
            console.log("[OPTI TEST] SLACK SEND SUCCESS");
        }

        await logDebugEvent({
          correlationId,
          eventType: 'completed',
          direction: 'SYSTEM',
          stage: 'Processing completed',
          status: 'ok',
          channelId,
          latencyMs
        });

      } catch (error) {
        console.error("Gemini Error:", error);
        
        let errorMessage = "Unknown error occurred.";
        if ((error as any).status === "RESOURCE_EXHAUSTED" || (error as any).message?.includes("429")) {
            errorMessage = "Gemini API Quota Exceeded. Please check billing or wait 24h.";
        } else {
            errorMessage = (error as any).message;
        }
        
        await logDebugEvent({
            correlationId,
            eventType: 'error',
            direction: 'ERROR',
            stage: 'Opti processing failed',
            status: 'failed',
            channelId,
            error: {
                message: errorMessage,
                stack: (error as any).stack
            }
        });

        await logDebugEvent({
          correlationId,
          eventType: 'completed',
          direction: 'SYSTEM',
          stage: 'Processing completed with error',
          status: 'failed',
          channelId
        });
        
        const reply: any = { text: "Sorry, I encountered an error processing your request." };
        if (threadTs) reply.thread_ts = threadTs;
        await say(reply);
      }
  });
  
  app.event('app_mention', async ({ event, say }) => {
      const correlationId = generateCorrelationId();
      
      await logDebugEvent({
        correlationId,
        eventType: 'app_mention',
        direction: 'SYSTEM',
        stage: 'Received Slack app_mention',
        status: 'ok',
        channelId: event.channel,
        text: event.text,
        userId: event.user,
        raw: event
      });

      console.log("[OPTI TEST] EVENT RECEIVED");
      console.log("[OPTI TEST] EVENT TYPE = app_mention");
      console.log("[OPTI TEST] CHANNEL =", event.channel);
      
      const channelId = event.channel;
      
      logMessageToFirestore({
        type: 'app_mention',
        channel: event.channel,
        user: event.user,
        text: event.text
      });

      // Constraint: Strictly limit to #optimal
      console.log("[OPTI TEST] ALLOWED CHANNEL =", optimalChannelId);
      console.log("[OPTI TEST] CHANNEL MATCH =", channelId === optimalChannelId);
      if (channelId !== optimalChannelId) {
          return;
      }
      
      const threadTs = event.thread_ts;
      const ts = event.ts;

      if (processedEvents.has(ts)) return;
      processedEvents.add(ts);
      setTimeout(() => processedEvents.delete(ts), 10000);
      
      const history = getHistory(channelId, threadTs || ts);
      const cleanedText = event.text; // Slack includes the mention text
      
      const inputItems = history.length > 0 
        ? [...history, { role: 'user', content: cleanedText }]
        : [{ role: 'user', content: cleanedText }];
      
      try {
        await logDebugEvent({
            correlationId,
            eventType: 'gemini_request',
            direction: 'SYSTEM',
            stage: 'Gemini request started',
            status: 'in_progress',
            channelId,
            raw: { inputItems }
        });

        const { finalOutput, history: newHistory } = await runAgent(inputItems, { app, channelId: optimalChannelId, correlationId, logDebugEvent });
        setHistory(channelId, threadTs || event.ts, newHistory);
        
        await logDebugEvent({
            correlationId,
            eventType: 'gemini_response',
            direction: 'SYSTEM',
            stage: 'Gemini response received',
            status: 'ok',
            channelId,
            text: finalOutput
        });

        if (!finalOutput.startsWith("SILENT")) {
          await logDebugEvent({
            correlationId,
            eventType: 'slack_send',
            direction: 'OPTI → SLACK',
            stage: 'Outbound Slack message',
            status: 'in_progress',
            channelId,
            text: finalOutput
          });
          
          const reply: any = { text: finalOutput };
          if (threadTs) reply.thread_ts = threadTs;
          const result = await say(reply);
          
          await logDebugEvent({
            correlationId,
            eventType: 'slack_send',
            direction: 'OPTI → SLACK',
            stage: 'Outbound Slack message',
            status: 'ok',
            channelId,
            text: finalOutput,
            raw: result
          });
        }
      } catch (error) {
        console.error("Gemini Error:", error);
        
        await logDebugEvent({
            correlationId,
            eventType: 'error',
            direction: 'ERROR',
            stage: 'Gemini/Agent processing',
            status: 'failed',
            channelId,
            error: {
                message: (error as any).message,
                stack: (error as any).stack
            }
        });
        
        const reply: any = { text: "Sorry, I encountered an error processing your request." };
        if (threadTs) reply.thread_ts = threadTs;
        await say(reply);
      }
  });
  
  app.event('*', async ({ event }) => {
      console.log("[OPTI TEST] CATCH-ALL EVENT RECEIVED", event);
  });
  
  return app;
}

async function startServer() {
  // OPTI DIAGNOSTICS: Identify Runtime Identity
  console.error("[OPTI] STARTING DIAGNOSTICS");
  try {
    console.error("[OPTI] ENV =", JSON.stringify(process.env, null, 2));
    const auth = new GoogleAuth();
    const projectId = await auth.getProjectId();
    
    console.error("==================================================");
    console.error("[OPTI] RUNTIME PROJECT =", projectId);
    console.error("[OPTI] FIRESTORE PROJECT TARGET =", "gen-lang-client-0899347402");
    console.error("[OPTI] FIRESTORE DATABASE TARGET =", "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7");
    console.error("==================================================");
    
    // Perform Startup Firestore Write Test
    await db.collection("debug_events").doc("iam_test").set({
      test: true,
      timestamp: FieldValue.serverTimestamp()
    });
    console.error("[OPTI] FIRESTORE WRITE TEST: PASS");
  } catch (error: any) {
    console.error("[OPTI] FIRESTORE DIAGNOSTICS FAILED");
    console.error("EXACT ERROR:", {
      code: error.code,
      status: error.status,
      message: error.message,
      targetProject: "gen-lang-client-0899347402",
      targetDatabase: "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7"
    });
  }

  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/debug/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    debugClients.add(res);

    req.on("close", () => {
      debugClients.delete(res);
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development (React SPA)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start Slack Bolt
  console.log("[OPTI] SLACK BOT STARTING");

  console.log("[OPTI] BOT TOKEN PRESENT =", !!process.env.SLACK_BOT_TOKEN);
  console.log("[OPTI] APP TOKEN PRESENT =", !!process.env.SLACK_APP_TOKEN);

  // 1. Initialize app
  const slackApp = initSlackApp();
  if (slackApp) {
    // 2. Resolve Channel ID
    if (process.env.OPTI_CHANNEL_ID) {
      optimalChannelId = process.env.OPTI_CHANNEL_ID;
      console.log("[OPTI] RESOLVED OPTIMAL CHANNEL ID FROM ENV =", optimalChannelId);
    } else {
      optimalChannelId = await fetchOptimalChannelId(slackApp);
      console.log("[OPTI] RESOLVED OPTIMAL CHANNEL ID FROM API =", optimalChannelId);
    }

    if (!optimalChannelId) {
      throw new Error(
        "OPTI_CHANNEL_ID could not be resolved. " +
        "FIX: Either set OPTI_CHANNEL_ID=<your-channel-id> in your .env file, " +
        "OR verify your Slack token configuration (ensure SLACK_BOT_TOKEN starts with 'xoxb-')."
      );
    }

    await slackApp.start();
    console.log("⚡️ Slack Bolt app is running!");
    await populateHistoricalMessages(slackApp, optimalChannelId);
  } else {
    console.log("Slack Bolt app skipped (tokens missing).");
  }

  // Start Express
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
