/**
 * Marktvragen chat (JI-DSH-07) env. Model identity is deployment config, not
 * code — prod runs an OpenRouter free-tier model; the key already lives in the
 * Trigger project env, never in git.
 */
export const requireOpenRouterApiKey = (): string => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for marktvragen-chat");
  }
  return apiKey;
};

const DEFAULT_CHAT_MODEL = "openai/gpt-oss-120b:free";

export const marktvragenChatModel = (): string =>
  process.env.MARKTVRAGEN_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
