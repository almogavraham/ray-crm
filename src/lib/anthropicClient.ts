/**
 * anthropicClient.ts
 *
 * Secure proxy client for Anthropic AI calls via Firebase onCall Functions.
 * The API key lives server-side only — never in the browser bundle.
 *
 * Usage (drop-in replacement for `new Anthropic({ apiKey })`):
 *   const client = getAnthropicProxy();
 *   const resp   = await client.messages.create({ model, messages, ... });
 *
 *   // "Streaming" callers also work — the full text is returned at once
 *   // and yielded in a single event so existing for-await loops still work:
 *   const stream = client.messages.stream({ model, messages, ... });
 *   for await (const event of stream) { ... }
 *   const final = await stream.finalMessage();
 */

import { httpsCallable } from 'firebase/functions';
import { functions, auth } from './firebase';

/* Firebase callable — timeout matches function timeout */
const callProxy = httpsCallable(functions, 'anthropicProxy', { timeout: 175_000 });

/**
 * Ensure there's a logged-in user with a FRESH ID token before calling the
 * proxy. Firebase ID tokens expire after ~1h; if the tab has been open a while
 * (or the refresh token was invalidated) the callable would be rejected at the
 * gateway with a cryptic "Unauthenticated" error. Force-refreshing here both
 * avoids that and surfaces a clear message when the session is truly gone.
 */
async function ensureFreshAuth(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('פג תוקף ההתחברות — התחבר מחדש כדי להשתמש ב-AI');
  }
  try {
    await user.getIdToken(true); // force token refresh
  } catch {
    throw new Error('פג תוקף ההתחברות — התחבר מחדש כדי להשתמש ב-AI');
  }
}

/* ── Non-streaming call ──────────────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function proxyCreate(params: Record<string, unknown>): Promise<any> {
  await ensureFreshAuth();
  const result = await callProxy(params);
  return result.data;
}

/* ── Streaming-compatible wrapper ────────────────────────────────────────── */
/**
 * Makes a regular (non-streaming) call but exposes the same async-iterable
 * interface as the Anthropic SDK MessageStream so existing for-await loops
 * keep working without changes.  The full text is yielded in one event.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function proxyStream(params: Record<string, unknown>): any {
  /* Start the call immediately so it runs in parallel with the for-await */
  const callPromise = proxyCreate(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function* generate(): AsyncGenerator<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callPromise;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
    if (text) {
      yield {
        type:  'content_block_delta',
        delta: { type: 'text_delta', text },
      };
    }
  }

  return {
    [Symbol.asyncIterator]: () => generate(),
    abort: () => { /* no-op: can't cancel an onCall in flight */ },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    finalMessage: (): Promise<any> =>
      callPromise.then(data => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        usage: (data as any)?.usage ?? { input_tokens: 0, output_tokens: 0 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: (data as any)?.content ?? [],
      })),
  };
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Drop-in replacement for `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAnthropicProxy(): any {
  return {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: (p: Record<string, unknown>): Promise<any> => proxyCreate(p),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream: (p: Record<string, unknown>): any => proxyStream(p),
    },
  };
}
