import type { Metadata } from "next";
import { ChatClient } from "@/components/ChatClient";

export const metadata: Metadata = { title: "Assistant" };

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-140px)] max-w-3xl flex-col">
      <div className="px-4 pt-5">
        <h1 className="text-lg font-bold text-navy-900">
          Assistant <span className="text-navy-400">· सहायक</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          Hindi, Hinglish or English. Facts only from authorized providers.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <ChatClient />
      </div>
    </div>
  );
}
