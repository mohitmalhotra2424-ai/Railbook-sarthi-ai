import { LlmNotConfiguredError, type LlmAdapter, type LlmResult } from "../types";

interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  modelVersion?: string;
}

export const geminiAdapter: LlmAdapter = {
  id: "gemini",
  defaultModel: "gemini-2.5-flash",

  isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  },

  async complete(request, transport = fetch): Promise<LlmResult> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new LlmNotConfiguredError("gemini");

    const model = process.env.GEMINI_MODEL?.trim() || this.defaultModel;

    const systemParts = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // The key goes in the x-goog-api-key HEADER — never in the URL, so it can
    // never leak via request-line logging.
    const response = await transport(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          ...(systemParts.length
            ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
            : {}),
          contents,
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxOutputTokens ?? 700,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}.`);
    }
    const json = (await response.json()) as GeminiGenerateResponse;
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (!text.trim()) throw new Error("Gemini returned an empty completion.");
    return { text, model: json.modelVersion ?? model, providerId: "gemini" };
  },
};
