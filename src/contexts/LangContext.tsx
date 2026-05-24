import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { translations } from '../i18n/translations';

type Lang = 'he' | 'en';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
  dir: 'rtl' | 'ltr';
}

const LangContext = createContext<LangContextValue | null>(null);

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem('ray-lang');
    if (stored === 'he' || stored === 'en') return stored;
  } catch {
    // ignore
  }
  return 'he';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem('ray-lang', newLang);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string): string => {
      return translations[lang][key] ?? translations['he'][key] ?? key;
    },
    [lang],
  );

  const dir: 'rtl' | 'ltr' = lang === 'he' ? 'rtl' : 'ltr';

  return (
    <LangContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}
