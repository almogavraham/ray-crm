/**
 * oauthOrigins.ts
 *
 * Every origin the app is ever served from. Google rejects an OAuth token
 * request whose page origin is not on the client's "Authorized JavaScript
 * origins" list, and the list is per-client — so a Client ID registered while
 * sitting on ray-crm.com silently fails the moment the same user opens the
 * admin console on admin.ray-crm.com.
 *
 * The setup guides therefore show the *whole* list rather than
 * `window.location.origin`, which only ever covers the tab you happen to be in.
 *
 * Keep in sync with the admin/client host detection in App.tsx.
 */

/** Production origins, in the order the setup guide should list them. */
export const OAUTH_ORIGINS: string[] = [
  'https://ray-crm.com',              // client app (custom domain)
  'https://www.ray-crm.com',
  'https://admin.ray-crm.com',        // admin console (custom domain)
  'https://chex-crm.web.app',         // admin console (Firebase default)
  'https://chex-crm.firebaseapp.com',
  'https://ray-crm-app.web.app',      // client app (Firebase default)
];

/**
 * The list to show a given user, with the origin they're currently on first —
 * that's the one that must be there for the connect button in front of them to
 * work at all. localhost is appended during development only.
 */
export function oauthOriginsForDisplay(): string[] {
  const here = typeof window !== 'undefined' ? window.location.origin : '';
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here);
  const all = [...OAUTH_ORIGINS, ...(isLocal ? [here] : [])];
  const rest = all.filter(o => o !== here);
  return here && all.includes(here) ? [here, ...rest] : all;
}
