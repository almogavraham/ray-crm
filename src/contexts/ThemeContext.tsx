/**
 * ThemeContext – provides dark/light design tokens to every page.
 * Inspired by Linear, Vercel, GitHub dark/light implementations.
 */
import { createContext, useContext, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

export interface ThemeColors {
  /* Page background */
  pageBg: string;
  pageBgImage: string;
  pageBgSize: string;
  /* Cards / panels */
  cardBg: string;
  cardBgAlt: string;          // slightly lighter card (nested)
  cardBorder: string;
  cardBorderStrong: string;
  /* Text */
  textPrimary: string;        // headings, main content
  textSecondary: string;      // labels, subtitles
  textMuted: string;          // placeholders, hints
  /* Inputs */
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  /* Subtle fills */
  subtleBg: string;
  subtleBgHover: string;
  /* Accent (indigo) */
  accentText: string;
  accentBg: string;
  accentBorder: string;
  /* Neon glow (dark only) */
  glow: string;
  /* Dividers */
  divider: string;
  /* Shadow */
  shadow: string;
}

/* ── Dark tokens (industry-standard dark mode) ───────────────────────────── */
export const DARK: ThemeColors = {
  pageBg:           '#0b1120',
  pageBgImage:      'radial-gradient(circle, rgba(99,102,241,0.10) 1px, transparent 1px)',
  pageBgSize:       '24px 24px',
  cardBg:           '#111827',
  cardBgAlt:        '#1a2236',
  cardBorder:       'rgba(255,255,255,0.09)',
  cardBorderStrong: 'rgba(255,255,255,0.16)',
  textPrimary:      '#f1f5f9',
  textSecondary:    '#94a3b8',
  textMuted:        '#64748b',
  inputBg:          '#1e2a3a',
  inputBorder:      'rgba(255,255,255,0.12)',
  inputText:        '#f1f5f9',
  inputPlaceholder: '#64748b',
  subtleBg:         'rgba(255,255,255,0.04)',
  subtleBgHover:    'rgba(255,255,255,0.08)',
  accentText:       '#818cf8',
  accentBg:         'rgba(99,102,241,0.15)',
  accentBorder:     'rgba(99,102,241,0.30)',
  glow:             '0 0 24px rgba(99,102,241,0.20)',
  divider:          'rgba(255,255,255,0.08)',
  shadow:           '0 4px 24px rgba(0,0,0,0.4)',
};

/* ── Light tokens (industry-standard light mode) ─────────────────────────── */
export const LIGHT: ThemeColors = {
  pageBg:           '#f1f5f9',
  pageBgImage:      'none',
  pageBgSize:       '24px 24px',
  cardBg:           '#ffffff',
  cardBgAlt:        '#f8fafc',
  cardBorder:       '#e2e8f0',
  cardBorderStrong: '#cbd5e1',
  textPrimary:      '#0f172a',
  textSecondary:    '#475569',
  textMuted:        '#94a3b8',
  inputBg:          '#f8fafc',
  inputBorder:      '#e2e8f0',
  inputText:        '#0f172a',
  inputPlaceholder: '#94a3b8',
  subtleBg:         '#f1f5f9',
  subtleBgHover:    '#e2e8f0',
  accentText:       '#4f46e5',
  accentBg:         '#eef2ff',
  accentBorder:     '#c7d2fe',
  glow:             'none',
  divider:          '#e2e8f0',
  shadow:           '0 4px 24px rgba(0,0,0,0.08)',
};

/* ── Context ─────────────────────────────────────────────────────────────── */
interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  c: ThemeColors;   // shorthand for colors
}

const ThemeContext = createContext<ThemeContextValue>({
  theme:  'light',
  isDark: false,
  c:      LIGHT,
});

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  const isDark = theme !== 'light';
  return (
    <ThemeContext.Provider value={{ theme, isDark, c: isDark ? DARK : LIGHT }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
