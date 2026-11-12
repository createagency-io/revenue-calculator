import type { SupabaseClient } from '@supabase/supabase-js';
import { nextDocNumber, type DocKind } from './calc';
import { defaultSettings } from './defaults';
import { loadData, saveData } from './storage';
import type { AppData, Project, Settings } from './types';

export class ConflictError extends Error {
  constructor(msg = 'Someone else changed this at the same time.') {
    super(msg);
    this.name = 'ConflictError';
  }
}
export class AuthError extends Error {
  constructor(msg = 'Your session has ended. Please sign in again.') {
    super(msg);
    this.name = 'AuthError';
  }
}
export class NetworkError extends Error {
  constructor(msg = 'Could not reach the database. Check your internet connection.') {
    super(msg);
    this.name = 'NetworkError';
  }
}

export interface Loaded {
  settings: Settings;
  settingsVersion: number | null;
  projects: { project: Project; version: number }[];
}

export type RemoteChange =
  | { table: 'projects'; type: 'upsert'; project: Project; version: number }
  | { table: 'projects'; type: 'delete'; id: string }
  | { table: 'settings'; settings: Settings; version: number };

export interface Backend {
  kind: 'supabase' | 'local';
  load(): Promise<Loaded>;
  loadProject(id: string): Promise<{ project: Project; version: number } | null>;
  saveProject(p: Project, expectedVersion: number | null): Promise<number>;
  deleteProject(id: string, expectedVersion: number): Promise<void>;
  saveSettings(s: Settings, expectedVersion: number | null): Promise<number>;
  nextNumber(kind: DocKind): Promise<string>;
  importAll(d: AppData): Promise<void>;
  deleteDemo(): Promise<number>;
  members(): Promise<{ email: string; display_name: string }[]>;
  subscribe(onChange: (c: RemoteChange) => void): () => void;
}

/* ------------------------------------------------------------- Supabase */

function mapError(e: { message?: string; code?: string; status?: number } | null): Error {
  const msg = e?.message ?? '';
  if (/conflict/i.test(msg)) return new ConflictError();
  if (/not_authorized|JWT|jwt|permission denied/i.test(msg) || e?.code === '42501' || e?.code === 'PGRST301' || e?.status === 401) return new AuthError(/not_authorized/.test(msg) ? 'This account is not on the C.R.E.A.T.E. team list.' : undefined);
  if (/fetch|network|Failed to fetch|Load failed|timeout/i.test(msg) || e?.status === 0) return new NetworkError();
  return new Error(msg || 'Unexpected database error');
}

function mergeCounters(s: Settings, counters: { kind: string; next: number }[]): Settings {
  const n = { ...s.numbering };
  for (const c of counters) {
    if (c.kind === 'quote') n.nextQuote = c.next;
    if (c.kind === 'invoice') n.nextInvoice = c.next;
    if (c.kind === 'receipt') n.nextReceipt = c.next;
  }
  return { ...s, numbering: n };
}

function withDefaults(saved: Partial<Settings> | null): Settings {
  const d = defaultSettings();
  if (!saved) return d;
  return { ...d, ...saved, company: { ...d.company, ...(saved.company ?? {}) }, numbering: { ...d.numbering, ...(saved.numbering ?? {}) }, pdf: { ...d.pdf, ...(saved.pdf ?? {}) }, splitChangeLog: saved.splitChangeLog ?? [] } as Settings;
}

export class SupabaseBackend implements Backend {
  kind = 'supabase' as const;
  private sb: SupabaseClient;
  constructor(sb: SupabaseClient) {
    this.sb = sb;
  }

  private async call<T>(p: PromiseLike<{ data: T | null; error: { message?: string; code?: string; status?: number } | null }>): Promise<T> {
    let res;
    try {
      res = await p;
    } catch (e) {
      throw mapError({ message: (e as Error).message });
    }
    if (res.error) throw mapError(res.error);
    return res.data as T;
  }

  async load(): Promise<Loaded> {
    const [settingsRows, counters, rows] = await Promise.all([
      this.call(this.sb.from('app_settings').select('data, version').eq('id', 1)),
      this.call(this.sb.from('doc_counters').select('kind, next')),
      this.fetchAllProjects(),
    ]);
    const srow = (settingsRows as { data: Settings; version: number }[])[0];
    return {
      settings: mergeCounters(withDefaults(srow?.data ?? null), counters as { kind: string; next: number }[]),
      settingsVersion: srow?.version ?? null,
      projects: rows,
    };
  }

  private async fetchAllProjects() {
    const out: { project: Project; version: number }[] = [];
    const page = 500;
    for (let from = 0; ; from += page) {
      const rows = (await this.call(this.sb.from('projects').select('id, data, version').order('id').range(from, from + page - 1))) as { id: string; data: Project; version: number }[];
      rows.forEach((r) => out.push({ project: r.data, version: r.version }));
      if (rows.length < page) break;
    }
    return out;
  }

  async loadProject(id: string) {
    const rows = (await this.call(this.sb.from('projects').select('data, version').eq('id', id))) as { data: Project; version: number }[];
    return rows[0] ? { project: rows[0].data, version: rows[0].version } : null;
  }

  async saveProject(p: Project, expectedVersion: number | null) {
    return (await this.call(this.sb.rpc('save_project', { p_id: p.id, p_data: p, p_expected_version: expectedVersion }))) as number;
  }

  async deleteProject(id: string, expectedVersion: number) {
    await this.call(this.sb.rpc('delete_project', { p_id: id, p_expected_version: expectedVersion }));
  }

  async saveSettings(s: Settings, expectedVersion: number | null) {
    return (await this.call(this.sb.rpc('save_settings', { p_data: s, p_expected_version: expectedVersion }))) as number;
  }

  async nextNumber(kind: DocKind) {
    return (await this.call(this.sb.rpc('next_doc_number', { p_kind: kind }))) as string;
  }

  async importAll(d: AppData) {
    await this.call(this.sb.rpc('import_all', { p_settings: d.settings, p_projects: d.projects }));
  }

  async deleteDemo() {
    return (await this.call(this.sb.rpc('delete_demo_projects'))) as number;
  }

  async members() {
    return (await this.call(this.sb.from('app_members').select('email, display_name').order('email'))) as { email: string; display_name: string }[];
  }

  subscribe(onChange: (c: RemoteChange) => void) {
    try {
      const ch = this.sb
        .channel('create-data')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string })?.id;
            if (id) onChange({ table: 'projects', type: 'delete', id });
          } else {
            const row = payload.new as { data: Project; version: number };
            if (row?.data) onChange({ table: 'projects', type: 'upsert', project: row.data, version: row.version });
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
          const row = payload.new as { data: Settings; version: number };
          if (row?.data) onChange({ table: 'settings', settings: withDefaults(row.data), version: row.version });
        })
        .subscribe();
      return () => {
        void this.sb.removeChannel(ch);
      };
    } catch {
      return () => {};
    }
  }
}

/* ---------------------------------------------- Local (offline demo mode) */

/** Keeps data in this browser only. Used for the offline demo mode and tests — no password, no sharing. */
export class LocalBackend implements Backend {
  kind = 'local' as const;
  private data: AppData;
  private versions = new Map<string, number>();
  private settingsVersion = 1;

  constructor() {
    this.data = loadData().data;
    this.data.projects.forEach((p) => this.versions.set(p.id, 1));
  }

  private persist() {
    saveData(this.data);
  }

  async load(): Promise<Loaded> {
    return { settings: structuredClone(this.data.settings), settingsVersion: this.settingsVersion, projects: this.data.projects.map((p) => ({ project: structuredClone(p), version: this.versions.get(p.id) ?? 1 })) };
  }

  async loadProject(id: string) {
    const p = this.data.projects.find((x) => x.id === id);
    return p ? { project: structuredClone(p), version: this.versions.get(id) ?? 1 } : null;
  }

  async saveProject(p: Project, expectedVersion: number | null) {
    const cur = this.versions.get(p.id) ?? null;
    if (cur !== expectedVersion) throw new ConflictError();
    const v = (cur ?? 0) + 1;
    this.versions.set(p.id, v);
    const i = this.data.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) this.data.projects[i] = structuredClone(p);
    else this.data.projects.unshift(structuredClone(p));
    this.persist();
    return v;
  }

  async deleteProject(id: string, expectedVersion: number) {
    if ((this.versions.get(id) ?? null) !== expectedVersion) throw new ConflictError();
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.versions.delete(id);
    this.persist();
  }

  async saveSettings(s: Settings, expectedVersion: number | null) {
    if (expectedVersion !== null && expectedVersion !== this.settingsVersion) throw new ConflictError();
    this.settingsVersion += 1;
    const n = this.data.settings.numbering;
    this.data.settings = structuredClone(s);
    // counters only move forward (same rule as the database)
    this.data.settings.numbering.nextQuote = Math.max(n.nextQuote, s.numbering.nextQuote);
    this.data.settings.numbering.nextInvoice = Math.max(n.nextInvoice, s.numbering.nextInvoice);
    this.data.settings.numbering.nextReceipt = Math.max(n.nextReceipt, s.numbering.nextReceipt);
    this.persist();
    return this.settingsVersion;
  }

  async nextNumber(kind: DocKind) {
    const { number, next } = nextDocNumber(this.data.settings, this.data.projects, kind);
    const key = kind === 'quote' ? 'nextQuote' : kind === 'invoice' ? 'nextInvoice' : 'nextReceipt';
    this.data.settings.numbering[key] = next;
    this.persist();
    return number;
  }

  async importAll(d: AppData) {
    this.data = structuredClone(d);
    this.versions.clear();
    this.data.projects.forEach((p) => this.versions.set(p.id, 1));
    this.settingsVersion += 1;
    this.persist();
  }

  async deleteDemo() {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => !p.isDemo);
    this.persist();
    return before - this.data.projects.length;
  }

  async members() {
    return [];
  }

  subscribe() {
    return () => {};
  }
}
