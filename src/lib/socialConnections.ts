/**
 * socialConnections.ts
 *
 * Unified social-network connection manager.
 * Supports: Facebook, Instagram, LinkedIn, TikTok, Twitter/X, YouTube.
 *
 * OAuth strategy per platform:
 *  - Facebook / Instagram : existing Meta integration (WorkspaceProfile.metaIntegration)
 *  - LinkedIn             : OAuth 2.0 popup → Cloud Function token exchange
 *  - TikTok               : OAuth 2.0 popup → Cloud Function token exchange
 *  - Twitter / X          : OAuth 2.0 popup → Cloud Function token exchange
 *  - YouTube              : reuses Google OAuth (GIS) → Cloud Function token exchange
 */

import { db } from './firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs,
} from 'firebase/firestore';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'twitter'
  | 'youtube'
  | 'google';

export interface SocialConnection {
  platform:     SocialPlatform;
  connected:    boolean;
  accountName?: string;   // display name / page name
  accountId?:   string;   // user/page/channel ID
  accessToken?: string;   // stored in Firestore (write-only in UI)
  refreshToken?:string;
  expiresAt?:   number;   // Unix ms
  pageId?:      string;   // LinkedIn organisation ID, YT channel ID, etc.
  clientId?:     string;  // OAuth app client ID configured by workspace admin
  clientSecret?: string;  // stored server-side in Firestore; never sent to client UI
  connectedAt?:  number;
}

export interface PlatformMeta {
  id:          SocialPlatform;
  label:       string;
  color:       string;      // primary brand colour
  bgColor:     string;      // subtle background
  emoji:       string;
  description: string;
  oauthSupported: boolean;  // true = popup OAuth; false = manual token
  tokenHelpUrl:   string;   // link to docs / token generator
  scopes?:        string;   // OAuth scopes (space-separated)
}

export const PLATFORMS: PlatformMeta[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    color: '#1877f2',
    bgColor: 'rgba(24,119,242,0.08)',
    emoji: '📘',
    description: 'פרסום לדפים, ניהול תגובות',
    oauthSupported: false,  // handled via existing Meta integration
    tokenHelpUrl: 'https://developers.facebook.com',
    scopes: 'pages_manage_posts pages_read_engagement',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    color: '#e1306c',
    bgColor: 'rgba(225,48,108,0.08)',
    emoji: '📸',
    description: 'פרסום תמונות, ריילס, סטורי',
    oauthSupported: false, // handled via Meta integration
    tokenHelpUrl: 'https://developers.facebook.com/docs/instagram-api',
    scopes: 'instagram_basic instagram_content_publish',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    color: '#0a66c2',
    bgColor: 'rgba(10,102,194,0.08)',
    emoji: '💼',
    description: 'פרסום לדפי חברה ופרופיל',
    oauthSupported: true,
    tokenHelpUrl: 'https://developer.linkedin.com',
    scopes: 'openid profile email w_member_social r_organization_social w_organization_social',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    color: '#010101',
    bgColor: 'rgba(1,1,1,0.06)',
    emoji: '🎵',
    description: 'פרסום ויוטות, תוכן וידאו',
    oauthSupported: true,
    tokenHelpUrl: 'https://developers.tiktok.com',
    scopes: 'user.info.basic,video.publish,video.upload',
  },
  {
    id: 'twitter',
    label: 'Twitter / X',
    color: '#000000',
    bgColor: 'rgba(0,0,0,0.05)',
    emoji: '🐦',
    description: 'פרסום ציוצים ותכנים',
    oauthSupported: true,
    tokenHelpUrl: 'https://developer.twitter.com',
    scopes: 'tweet.read tweet.write users.read offline.access',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    color: '#ff0000',
    bgColor: 'rgba(255,0,0,0.06)',
    emoji: '📺',
    description: 'העלאת סרטונים, ניהול ערוץ',
    oauthSupported: true,
    tokenHelpUrl: 'https://console.cloud.google.com',
    scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
  },
  {
    id: 'google',
    label: 'Google',
    color: '#4285f4',
    bgColor: 'rgba(66,133,244,0.08)',
    emoji: '🔍',
    description: 'Google Ads, Analytics, Business Profile',
    oauthSupported: true,
    tokenHelpUrl: 'https://console.cloud.google.com',
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/business.manage',
    ].join(' '),
  },
];

/* ── Firestore helpers ──────────────────────────────────────────────────────── */

export async function loadSocialConnections(wid: string): Promise<SocialConnection[]> {
  try {
    const snap = await getDocs(collection(db, 'workspaces', wid, 'socialConnections'));
    return snap.docs.map(d => d.data() as SocialConnection);
  } catch { return []; }
}

export async function saveSocialConnection(wid: string, conn: SocialConnection): Promise<void> {
  await setDoc(doc(db, 'workspaces', wid, 'socialConnections', conn.platform), conn);
}

export async function deleteSocialConnection(wid: string, platform: SocialPlatform): Promise<void> {
  await deleteDoc(doc(db, 'workspaces', wid, 'socialConnections', platform));
}

export async function loadSocialConnection(wid: string, platform: SocialPlatform): Promise<SocialConnection | null> {
  try {
    const snap = await getDoc(doc(db, 'workspaces', wid, 'socialConnections', platform));
    return snap.exists() ? (snap.data() as SocialConnection) : null;
  } catch { return null; }
}

/* ── OAuth popup helper ─────────────────────────────────────────────────────── */

const OAUTH_URLS: Record<SocialPlatform, (clientId: string, redirectUri: string, state: string) => string> = {
  linkedin: (clientId, redirectUri, state) =>
    `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(PLATFORMS.find(p=>p.id==='linkedin')!.scopes!)}`,
  tiktok: (clientId, redirectUri, state) =>
    `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientId}&response_type=code&scope=${encodeURIComponent(PLATFORMS.find(p=>p.id==='tiktok')!.scopes!)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
  twitter: (clientId, redirectUri, state) =>
    `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(PLATFORMS.find(p=>p.id==='twitter')!.scopes!)}&state=${state}&code_challenge=challenge&code_challenge_method=plain`,
  youtube: (clientId, redirectUri, state) =>
    `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(PLATFORMS.find(p=>p.id==='youtube')!.scopes!)}&state=${state}&access_type=offline`,
  google: (clientId, redirectUri, state) =>
    `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(PLATFORMS.find(p=>p.id==='google')!.scopes!)}&state=${state}&access_type=offline&prompt=consent`,
  facebook:  () => '',
  instagram: () => '',
};

/**
 * Opens an OAuth popup and waits for the auth code via postMessage.
 * Returns the auth code string or throws on error/timeout.
 */
export function openOAuthPopup(
  platform: SocialPlatform,
  clientId: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const state = `${platform}:${Date.now()}`;
    const urlFn = OAUTH_URLS[platform];
    if (!urlFn) { reject(new Error('Platform not supported')); return; }

    const url = urlFn(clientId, redirectUri, state);
    const popup = window.open(url, 'oauth_popup', 'width=520,height=640,left=200,top=100');
    if (!popup) { reject(new Error('Popup blocked — allow popups for this site')); return; }

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('OAuth timeout — window closed'));
    }, 5 * 60 * 1000);

    function handler(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'oauth_callback') return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      popup.close();
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else if (e.data.code) {
        resolve(e.data.code);
      } else {
        reject(new Error('No code received'));
      }
    }
    window.addEventListener('message', handler);
  });
}

/* ── Cloud Function: exchange OAuth code for access token ───────────────────── */

export async function exchangeSocialToken(opts: {
  platform: SocialPlatform;
  code: string;
  workspaceId: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; accountName?: string; accountId?: string }> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<
    { platform: string; code: string; workspaceId: string; redirectUri: string },
    { accessToken: string; refreshToken?: string; expiresIn?: number; accountName?: string; accountId?: string }
  >(fns, 'exchangeSocialToken');
  const result = await fn({
    platform:    opts.platform,
    code:        opts.code,
    workspaceId: opts.workspaceId,
    redirectUri: `${window.location.origin}/oauth-callback.html`,
  });
  return result.data;
}

/* ── Cloud Function: post to social network ─────────────────────────────────── */

export async function postToSocial(
  platform: SocialPlatform,
  accessToken: string,
  message: string,
  imageUrl?: string,
  pageId?: string,
): Promise<{ postId: string; url?: string }> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<
    { platform: string; accessToken: string; message: string; imageUrl?: string; pageId?: string },
    { postId: string; url?: string }
  >(fns, 'postToSocial');
  const result = await fn({ platform, accessToken, message, imageUrl, pageId });
  return result.data;
}

/* ── Check token validity ────────────────────────────────────────────────────── */

export function isConnectionValid(conn: SocialConnection): boolean {
  if (!conn.connected || !conn.accessToken) return false;
  if (conn.expiresAt && conn.expiresAt < Date.now() + 60_000) return false;
  return true;
}
