import { LlmNotConfiguredError, type LlmAdapter, type LlmResult } from "../types";

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
}

export const openaiAdapter: LlmAdapter = {
  id: "openai",
  defaultModel: "gpt-4o-mini",

  isConfigured(): boolean {
    const key = process.env.OPENAI_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  },

  async complete(request, transport = fetch): Promise<LlmResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new LlmNotConfiguredError("openai");

    const model = process.env.OPENAI_MODEL?.trim() || this.defaultModel;
    const baseUrl = (
      process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"
    ).replace(/\/$/, "");

    const response = await transport(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens ?? 700,
      }),
    });

    if (!response.ok) {
      // Status only — never echo upstream bodies into errors/logs.
      throw new Error(`OpenAI request failed with status ${response.status}.`);
    }
    const json = (await response.json()) as OpenAiChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("OpenAI returned an empty completion.");
    return { text, model: json.model ?? model, providerId: "openai" };
  },
};
