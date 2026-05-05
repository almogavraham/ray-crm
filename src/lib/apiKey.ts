/**
 * Returns the Anthropic API key if it looks valid (starts with sk-ant-).
 * Returns null if missing or still a placeholder.
 */
export function getApiKey(): string | null {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  if (!key || !key.startsWith('sk-ant-')) return null;
  return key;
}

export const API_KEY_ERROR =
  '⚠️ מפתח API חסר.\n\nכדי להפעיל את ה-AI:\n1. פתח את קובץ .env בתיקיית הפרויקט\n2. החלף את הערך של VITE_ANTHROPIC_API_KEY במפתח האמיתי שלך\n3. המפתח מתחיל ב: sk-ant-...\n4. הפעל מחדש: npm run dev';

/**
 * Returns the OpenAI API key if valid (starts with sk-).
 * Returns null if missing or placeholder.
 */
export function getOpenAiKey(): string | null {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key || !key.startsWith('sk-')) return null;
  return key;
}
