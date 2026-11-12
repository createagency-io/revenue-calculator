import { describe, expect, it } from 'vitest';
import { isServiceKey, saveBrowserConfig } from './config';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'setItem' | 'getItem' | 'removeItem'> }).localStorage = { setItem: (k, v) => void mem.set(k, v), getItem: (k) => mem.get(k) ?? null, removeItem: (k) => void mem.delete(k) };

const jwt = (payload: object) => `xx.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.yy`;

describe('config keys', () => {
  it('refuses the secret service_role key', () => {
    expect(isServiceKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(saveBrowserConfig('https://abc.supabase.co', jwt({ role: 'service_role' }))).toMatch(/service_role/);
  });
  it('accepts anon and publishable keys', () => {
    expect(isServiceKey(jwt({ role: 'anon' }))).toBe(false);
    expect(saveBrowserConfig('https://abc.supabase.co', jwt({ role: 'anon' }))).toBeNull();
    expect(saveBrowserConfig('https://abc.supabase.co', 'sb_publishable_abc123')).toBeNull();
    expect(saveBrowserConfig('https://abc.supabase.co', 'sb_secret_abc123')).not.toBeNull();
    expect(saveBrowserConfig('not a url', jwt({ role: 'anon' }))).not.toBeNull();
  });
});
