'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A per-browser boolean flag (e.g. "tour seen", "welcome dismissed"). Storage
 * failures (private windows, blocked storage) degrade to "not persisted" —
 * guidance may reappear, which is harmless. `ready` is false until the stored
 * value has been read, so callers can avoid a flash of guidance.
 */
export function useLocalFlag(key: string): {
  value: boolean;
  ready: boolean;
  set: (v: boolean) => void;
} {
  const [value, setValue] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) === '1');
    } catch {
      setValue(false);
    }
    setReady(true);
  }, [key]);

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        if (v) localStorage.setItem(key, '1');
        else localStorage.removeItem(key);
      } catch {
        /* not persisted */
      }
    },
    [key],
  );

  return { value, ready, set };
}
