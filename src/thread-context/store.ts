
// Simple in-memory conversation store with TTL
const history = new Map<string, { messages: any[], timestamp: number }>();
const TTL = 1000 * 60 * 30; // 30 minutes

export function getHistory(channelId: string, threadTs?: string) {
    const key = threadTs ? `${channelId}:${threadTs}` : channelId;
    const entry = history.get(key);
    
    if (entry && (Date.now() - entry.timestamp < TTL)) {
        return entry.messages;
    }
    return [];
}

export function setHistory(channelId: string, threadTs: string | undefined, messages: any[]) {
    const key = threadTs ? `${channelId}:${threadTs}` : channelId;
    history.set(key, { messages, timestamp: Date.now() });
}
