export type AppearancePreference = 'light' | 'dark' | 'system';
export type ResolvedAppearance = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'aivoryx.appearance';
export const BRAND_CACHE_STORAGE_KEY = 'aivoryx.brandcss';

export const APPEARANCE_OPTIONS: { value: AppearancePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function isAppearancePreference(v: unknown): v is AppearancePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Runs synchronously in <head> before first paint so the page never flashes the
 * wrong theme: applies `.dark` from the stored preference (or the OS setting)
 * and re-injects the last-seen tenant brand CSS. Kept as a string constant —
 * it is static, contains no user data, and is the only inline script.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var p=localStorage.getItem('${APPEARANCE_STORAGE_KEY}');if(p!=='light'&&p!=='dark'&&p!=='system')p='system';var dark=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)d.classList.add('dark');d.dataset.appearance=p;var c=localStorage.getItem('${BRAND_CACHE_STORAGE_KEY}');var q=location.pathname;if(c&&c.indexOf('<')<0&&q.indexOf('/login')!==0&&q.indexOf('/accept-invitation')!==0){var s=document.createElement('style');s.id='aivoryx-brand-cache';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;
