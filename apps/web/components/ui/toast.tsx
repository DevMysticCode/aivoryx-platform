'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@aivoryx/ui';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Minimal, dependency-free toast surface (§46). Transient confirmations only —
 * important errors stay in context on the page, not just here.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = (seq.current += 1);
    setItems((prev) => [...prev, { id, tone, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg',
              t.tone === 'success' && 'border-emerald-500/30 bg-background text-foreground',
              t.tone === 'error' && 'border-destructive/40 bg-background text-foreground',
              t.tone === 'info' && 'border-border bg-background text-foreground',
            )}
          >
            <span
              className={cn(
                'mr-2 inline-block size-2 rounded-full align-middle',
                t.tone === 'success' && 'bg-emerald-500',
                t.tone === 'error' && 'bg-destructive',
                t.tone === 'info' && 'bg-muted-foreground',
              )}
              aria-hidden
            />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
