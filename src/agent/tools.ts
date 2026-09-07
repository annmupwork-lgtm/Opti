
import { App } from "@slack/bolt";
import { Type } from "@google/genai";

export const slackTools = [
  {
    name: "slack_search",
    description: "Search messages ONLY inside the #optimal channel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The search query (e.g., 'pricing')" },
      },
      required: ["query"],
    },
  },
  {
    name: "slack_get_context",
    description: "Retrieve thread context ONLY from #optimal channel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        thread_ts: { type: Type.STRING, description: "The timestamp of the thread" },
      },
      required: ["thread_ts"],
    },
  },
  {
    name: "slack_send_message",
    description: "Send a message or reply to the #optimal channel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "The message text" },
        thread_ts: { type: Type.STRING, description: "Optional thread timestamp to reply to" },
      },
      required: ["text"],
    },
  },
];
// ... rest of tools.ts ...

export async function executeTool(toolName: string, args: any, deps: { app: App, channelId: string | null }) {
  const { app, channelId } = deps;
  if (!channelId) throw new Error("No allowed channel configured.");

  switch (toolName) {
    case "slack_search":
      // Using in:#optimal restriction in query
      const searchQuery = `${args.query} in:#optimal`;
      try {
        const searchResult = await app.client.search.messages({ query: searchQuery });
        return searchResult.messages?.matches?.map(m => ({
            channel: "optimal",
            user: m.user,
            timestamp: m.ts,
            thread_ts: (m as any).thread_ts,
            text: m.text,
        })) || [];
      } catch (error) {
        console.error("Slack search failed:", error);
        return "Slack search is not available because the app does not have the required user permissions (requires User Token).";
      }
      
    case "slack_get_context":
      // Verify thread is in channelId? The API handles it if we provide the right channel.
      const history = await app.client.conversations.replies({
        channel: channelId,
        ts: args.thread_ts,
      });
      return history.messages || [];
      
    case "slack_send_message":
      const postArgs: any = { channel: channelId, text: args.text };
      if (args.thread_ts) postArgs.thread_ts = args.thread_ts;
      return await app.client.chat.postMessage(postArgs);
      
    default:
      throw new Error(`Tool ${toolName} not found.`);
  }
}
