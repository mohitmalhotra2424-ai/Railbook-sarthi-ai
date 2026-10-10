import { LlmNotConfiguredError, type LlmAdapter, type LlmResult } from "../types";

interface AnthropicMessagesResponse {
  content?: { type: string; text?: string }[];
  model?: string;
}

export const anthropicAdapter: LlmAdapter = {
  id: "anthropic",
  defaultModel: "claude-sonnet-4-5",

  isConfigured(): boolean {
    const key = process.env.ANTHROPIC_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  },

  async complete(request, transport = fetch): Promise<LlmResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new LlmNotConfiguredError("anthropic");

    const model = process.env.ANTHROPIC_MODEL?.trim() || this.defaultModel;

    // Anthropic takes `system` as a top-level parameter, not a message role.
    const systemParts = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await transport("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxOutputTokens ?? 700,
        ...(systemParts.length ? { system: systemParts.join("\n\n") } : {}),
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed with status ${response.status}.`);
    }
    const json = (await response.json()) as AnthropicMessagesResponse;
    const text = (json.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    if (!text.trim()) throw new Error("Anthropic returned an empty completion.");
    return { text, model: json.model ?? model, providerId: "anthropic" };
  },
};
