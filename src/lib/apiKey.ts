/**
 * getApiKey — DEPRECATED (returns null; kept for legacy call-sites during migration).
 * Anthropic calls now go through the secure Firebase Function proxy (anthropicClient.ts).
 * Do NOT use this function — use getAnthropicProxy() from anthropicClient.ts instead.
 */
export function getApiKey(): string | null {
  return null; // Key is stored server-side — use getAnthropicProxy()
}

/** @deprecated - use getAnthropicProxy() */
export const API_KEY_ERROR = '';

/**
 * Returns the OpenAI API key if valid (starts with sk-).
 * Returns null if missing or placeholder.
 */
export function getOpenAiKey(): string | null {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key || !key.startsWith('sk-')) return null;
  return key;
}
