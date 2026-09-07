import React, { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export const ConversationMirror: React.FC = () => {
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, "conversations"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm mt-4">
      <h2 className="text-lg font-semibold mb-2">Slack Conversation Mirror</h2>
      <div className="h-96 overflow-y-auto space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className="p-2 border-b text-sm">
            <span className="font-bold">{msg.user || "Bot"}: </span>
            {msg.text}
            <div className="text-[10px] text-gray-400">
              {msg.timestamp?.toDate().toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
