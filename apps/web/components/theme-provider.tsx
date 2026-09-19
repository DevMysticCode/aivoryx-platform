'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  type AppearancePreference,
  type ResolvedAppearance,
  isAppearancePreference,
  resolveAppearance,
} from '@/lib/theme/appearance';

interface AppearanceContextValue {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
  setPreference: (p: AppearancePreference) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readStored(): AppearancePreference {
  try {
    const v = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearancePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * User-level appearance (Light / Dark / System). The <head> init script has
 * already put the right class on <html> before paint; this provider keeps it in
 * sync afterwards: preference changes, OS scheme changes while on "System", and
 * changes made in another tab. Purely presentational — never a security input.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setPreferenceState(readStored());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onScheme = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onScheme);
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_STORAGE_KEY) setPreferenceState(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onScheme);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const resolved = resolveAppearance(preference, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.appearance = preference;
  }, [resolved, preference]);

  const setPreference = useCallback((p: AppearancePreference) => {
    setPreferenceState(p);
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, p);
    } catch {
      /* storage blocked — the preference still applies for this session */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside <ThemeProvider>');
  return ctx;
}
