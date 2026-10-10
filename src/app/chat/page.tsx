import type { Metadata } from "next";
import { ChatClient } from "@/components/ChatClient";

export const metadata: Metadata = { title: "Assistant" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const initialMessage = typeof q === "string" ? q.trim().slice(0, 2000) : "";

  return (
    // Full-height conversation surface: header above, composer anchored at the
    // bottom, the page footer stays below the fold while chatting.
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col">
      <ChatClient initialMessage={initialMessage || undefined} />
    </div>
  );
}
