/**
 * Where the app finds its Supabase project.
 *  1. public/config.js (window.CREATE_CONFIG) — used on the deployed Netlify site.
 *  2. Keys pasted into the setup screen (saved in this browser) — handy for the one-file version.
 */
export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  idleMinutes: number;
  source: 'config.js' | 'browser';
}

declare global {
  interface Window {
    CREATE_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string; idleMinutes?: number };
  }
}

const KEY = 'create-agency-rms:supabase-config';

/** True if a JWT key is the all-powerful service_role key, which must never be used in the browser. */
export function isServiceKey(key?: string): boolean {
  try {
    const part = (key ?? '').trim().split('.')[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}

function valid(url?: string, key?: string): boolean {
  if (isServiceKey(key)) return false;
  // Accepts the classic "anon" key (a JWT with two dots) or the newer "publishable" key (sb_publishable_...).
  const k = key?.trim() ?? '';
  return !!url && /^https?:\/\/[^\s]+$/.test(url.trim()) && (k.split('.').length === 3 || /^sb_publishable_[A-Za-z0-9_-]+$/.test(k));
}

export function readConfig(): AppConfig | null {
  const w = typeof window !== 'undefined' ? window.CREATE_CONFIG : undefined;
  const idle = Math.max(5, Math.min(240, Number(w?.idleMinutes) || 30));
  if (w && valid(w.supabaseUrl, w.supabaseAnonKey)) {
    return { supabaseUrl: w.supabaseUrl!.trim().replace(/\/+$/, ''), supabaseAnonKey: w.supabaseAnonKey!.trim(), idleMinutes: idle, source: 'config.js' };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && valid(saved.supabaseUrl, saved.supabaseAnonKey)) return { supabaseUrl: saved.supabaseUrl, supabaseAnonKey: saved.supabaseAnonKey, idleMinutes: idle, source: 'browser' };
  } catch {
    /* ignore */
  }
  return null;
}

export function saveBrowserConfig(url: string, key: string): string | null {
  if (isServiceKey(key)) return 'That is the secret service_role key — never use it in the app. Copy the “anon public” key instead.';
  if (!valid(url, key)) return 'Check both values: the URL starts with https:// and the key is either the long “anon” code (starts with eyJ) or the “publishable” key (starts with sb_publishable_). Never paste the secret/service_role key.';
  try {
    localStorage.setItem(KEY, JSON.stringify({ supabaseUrl: url.trim().replace(/\/+$/, ''), supabaseAnonKey: key.trim() }));
    return null;
  } catch {
    return 'This browser blocked saving the settings.';
  }
}

export function clearBrowserConfig() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
