import React, { useEffect, useState } from "react";
import { MessageSquare, Bot, ChevronRight, ChevronDown, Clock, AlertCircle, Terminal, Activity } from "lucide-react";

const getEventType = (event: any) => {
  switch (event.eventType) {
    case "slack_message":
    case "app_mention":
      return "user";

    case "gemini_request":
      return "thinking";

    case "gemini_response":
      return "response";

    case "decision":
      return event.decision === "silent"
        ? "silent"
        : "decision";

    case "tool_call":
    case "tool_result":
      return "tool";

    case "slack_send":
      return "response";

    case "error":
      return "error";

    case "completed":
      return "completed";

    case "processing":
      return "processing";

    default:
      return "system";
  }
};

function formatTimestamp(timestamp: any) {
  if (!timestamp) return new Date().toLocaleTimeString();

  if (typeof timestamp === "string" || typeof timestamp === "number") {
    return new Date(timestamp).toLocaleTimeString();
  }

  if (timestamp.seconds) {
    return new Date(timestamp.seconds * 1000).toLocaleTimeString();
  }

  return new Date().toLocaleTimeString();
}

export const Debugger: React.FC = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let eventSource: EventSource;

    const connect = () => {
      eventSource = new EventSource("/api/debug/stream");

      eventSource.onopen = () => setStatus('connected');
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setEvents(prev => [...prev, { ...data, id: Date.now() + Math.random() }]);
      };
      eventSource.onerror = () => {
        setStatus('disconnected');
        eventSource.close();
        setTimeout(connect, 2000);
      };
    };

    connect();
    return () => eventSource?.close();
  }, []);

  const toggleExpand = (id: number) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Chat Mirror</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {status === 'connected' ? '● LIVE' : '● DISCONNECTED'}
        </span>
      </div>

      <div className="space-y-4">
        {events.map((event, index) => {
          const type = getEventType(event);
          const timestamp = formatTimestamp(event.timestamp);
          const isExpanded = expandedIds.has(index);

          const icons: Record<string, React.ReactNode> = {
            user: <MessageSquare className="w-5 h-5 text-gray-500 mt-0.5" />,
            thinking: <Activity className="w-5 h-5 text-yellow-500 mt-0.5" />,
            response: <Bot className="w-5 h-5 text-blue-500 mt-0.5" />,
            tool: <Terminal className="w-5 h-5 text-purple-500 mt-0.5" />,
            error: <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />,
            completed: <Activity className="w-5 h-5 text-green-500 mt-0.5" />,
            processing: <Activity className="w-5 h-5 text-gray-400 mt-0.5" />,
            system: <Terminal className="w-5 h-5 text-gray-400 mt-0.5" />,
            silent: <Bot className="w-5 h-5 text-gray-300 mt-0.5" />,
            decision: <MessageSquare className="w-5 h-5 text-orange-500 mt-0.5" />
          };

          return (
            <div key={event.id || index} className={`p-4 rounded-lg border ${type === 'error' ? 'bg-red-50 border-red-200' : 'bg-white'}`}>
              <div className="flex items-start gap-3 cursor-pointer" onClick={() => toggleExpand(index)}>
                {icons[type] || icons.system}
                <div className="flex-grow">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-bold uppercase text-xs text-gray-500">{type}</span>
                    <span className="text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3"/> {timestamp}</span>
                  </div>
                  <p className="text-gray-700">{event.text || event.error?.message || event.stage || type}</p>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 mt-1" /> : <ChevronRight className="w-4 h-4 text-gray-400 mt-1" />}
              </div>
              
              {isExpanded && (
                <pre className="mt-3 p-3 bg-gray-100 rounded text-xs text-gray-600 overflow-x-auto font-mono">
                  {JSON.stringify(event, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
