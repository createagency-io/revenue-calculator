import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthError, ConflictError, NetworkError, type Backend, type RemoteChange } from './backend';
import type { DocKind } from './calc';
import { defaultSettings } from './defaults';
import { demoData } from './demo';
import type { AppData, Project, Settings } from './types';

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

export interface ProjectConflict {
  mine: Project;
  theirs: { project: Project; version: number } | null; // null = they deleted it
}

interface StoreValue {
  data: AppData;
  backendKind: Backend['kind'];
  sync: { status: SyncStatus; pending: number; message: string | null };
  upsertProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  updateSettings: (fn: (s: Settings) => Settings) => void;
  replaceAll: (d: AppData) => Promise<void>;
  takeNumber: (kind: DocKind) => Promise<string>;
  clearDemo: () => Promise<void>;
  resetEverything: (withDemo: boolean) => Promise<void>;
  reload: () => Promise<void>;
  members: () => Promise<{ email: string; display_name: string }[]>;
  conflict: ProjectConflict | null;
  resolveConflict: (keep: 'mine' | 'theirs') => void;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  toastState: { msg: string; kind: 'ok' | 'err' } | null;
}

type Op = { type: 'save'; project: Project } | { type: 'delete' } | { type: 'settings'; settings: Settings };

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ backend, initial, onAuthError, children }: { backend: Backend; initial: { data: AppData; versions: Map<string, number>; settingsVersion: number | null }; onAuthError: (msg: string) => void; children: ReactNode }) {
  const [data, setDataState] = useState<AppData>(initial.data);
  const dataRef = useRef(initial.data);
  const versions = useRef(new Map(initial.versions));
  const settingsVersion = useRef<number | null>(initial.settingsVersion);
  const queue = useRef(new Map<string, Op>());
  const inflight = useRef(new Set<string>());
  const retryTimer = useRef<number | undefined>(undefined);
  const retryDelay = useRef(2000);
  const [sync, setSync] = useState<StoreValue['sync']>({ status: 'saved', pending: 0, message: null });
  const [conflict, setConflict] = useState<ProjectConflict | null>(null);
  const [toastState, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const setData = useCallback((fn: (d: AppData) => AppData) => {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setDataState(next);
  }, []);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refreshSync = useCallback((status?: SyncStatus, message: string | null = null) => {
    const pending = queue.current.size + inflight.current.size;
    setSync((s) => ({ status: status ?? (pending ? 'saving' : s.status === 'error' ? 'error' : 'saved'), pending, message: message ?? (status === undefined && !pending ? null : s.message) }));
  }, []);

  // Warn before closing the tab while changes are still being saved.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queue.current.size + inflight.current.size > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const flush = useCallback(
    async (key: string): Promise<void> => {
      if (inflight.current.has(key)) return;
      const op = queue.current.get(key);
      if (!op) return;
      queue.current.delete(key);
      inflight.current.add(key);
      refreshSync('saving');
      const id = key.slice(2);
      try {
        if (op.type === 'save') {
          const v = await backend.saveProject(op.project, versions.current.get(id) ?? null);
          versions.current.set(id, v);
        } else if (op.type === 'delete') {
          const v = versions.current.get(id);
          if (v !== undefined) await backend.deleteProject(id, v);
          versions.current.delete(id);
        } else {
          settingsVersion.current = await backend.saveSettings(op.settings, settingsVersion.current);
        }
        retryDelay.current = 2000;
        inflight.current.delete(key);
        refreshSync(queue.current.size + inflight.current.size ? 'saving' : 'saved', null);
      } catch (e) {
        inflight.current.delete(key);
        if (e instanceof NetworkError) {
          if (!queue.current.has(key)) queue.current.set(key, op); // a newer change wins if one was made meanwhile
          refreshSync('offline', 'No connection — your changes are kept here and will save automatically.');
          window.clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(() => {
            [...queue.current.keys()].forEach((k) => void flush(k));
          }, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
          return;
        }
        if (e instanceof ConflictError) {
          if (op.type === 'save') {
            const theirs = await backend.loadProject(id).catch(() => null);
            setConflict({ mine: op.project, theirs });
          } else if (op.type === 'delete') {
            const theirs = await backend.loadProject(id).catch(() => null);
            if (theirs) {
              versions.current.set(id, theirs.version);
              setData((d) => ({ ...d, projects: [theirs.project, ...d.projects.filter((p) => p.id !== id)] }));
              toast('Someone else changed that project just now, so it was not deleted. Check it and try again.', 'err');
            }
          } else {
            const fresh = await backend.load().catch(() => null);
            if (fresh) {
              settingsVersion.current = fresh.settingsVersion;
              setData((d) => ({ ...d, settings: fresh.settings }));
            }
            toast('Someone else saved the settings at the same time. Their version is now showing — please redo your change.', 'err');
          }
          refreshSync(undefined);
          return;
        }
        if (e instanceof AuthError) {
          refreshSync('error', e.message);
          onAuthError(e.message);
          return;
        }
        refreshSync('error', `Not saved: ${(e as Error).message}`);
        toast(`Could not save: ${(e as Error).message}`, 'err');
        return;
      }
      if (queue.current.has(key)) void flush(key);
    },
    [backend, onAuthError, refreshSync, setData, toast],
  );

  const enqueue = useCallback(
    (key: string, op: Op) => {
      queue.current.set(key, op);
      refreshSync('saving');
      void flush(key);
    },
    [flush, refreshSync],
  );

  const upsertProject = useCallback(
    (p: Project) => {
      const next = { ...p, updatedAt: new Date().toISOString() };
      setData((d) => {
        const exists = d.projects.some((x) => x.id === p.id);
        return { ...d, projects: exists ? d.projects.map((x) => (x.id === p.id ? next : x)) : [next, ...d.projects] };
      });
      enqueue(`p:${p.id}`, { type: 'save', project: next });
    },
    [enqueue, setData],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setData((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== id) }));
      enqueue(`p:${id}`, { type: 'delete' });
    },
    [enqueue, setData],
  );

  const updateSettings = useCallback(
    (fn: (s: Settings) => Settings) => {
      const next = fn(dataRef.current.settings);
      setData((d) => ({ ...d, settings: next }));
      enqueue('s:settings', { type: 'settings', settings: next });
    },
    [enqueue, setData],
  );

  const reload = useCallback(async () => {
    const fresh = await backend.load();
    versions.current = new Map(fresh.projects.map((x) => [x.project.id, x.version]));
    settingsVersion.current = fresh.settingsVersion;
    setData(() => ({ settings: fresh.settings, projects: fresh.projects.map((x) => x.project) }));
  }, [backend, setData]);

  const waitIdle = useCallback(async () => {
    for (let i = 0; i < 100 && queue.current.size + inflight.current.size > 0; i++) await new Promise((r) => setTimeout(r, 100));
  }, []);

  const replaceAll = useCallback(
    async (d: AppData) => {
      await waitIdle();
      await backend.importAll(d);
      await reload();
    },
    [backend, reload, waitIdle],
  );

  const takeNumber = useCallback(
    async (kind: DocKind) => {
      const num = await backend.nextNumber(kind);
      // Keep the "next number" shown in Settings roughly current (display only).
      const n = Number(num.split('-').pop());
      if (Number.isFinite(n)) {
        const key = kind === 'quote' ? 'nextQuote' : kind === 'invoice' ? 'nextInvoice' : 'nextReceipt';
        setData((d) => ({ ...d, settings: { ...d.settings, numbering: { ...d.settings.numbering, [key]: Math.max(d.settings.numbering[key], n + 1) } } }));
      }
      return num;
    },
    [backend, setData],
  );

  const clearDemo = useCallback(async () => {
    await waitIdle();
    await backend.deleteDemo();
    await reload();
  }, [backend, reload, waitIdle]);

  const resetEverything = useCallback(
    async (withDemo: boolean) => {
      await waitIdle();
      await backend.importAll(withDemo ? demoData() : { settings: defaultSettings(), projects: [] });
      await reload();
    },
    [backend, reload, waitIdle],
  );

  const resolveConflict = useCallback(
    (keep: 'mine' | 'theirs') => {
      const c = conflict;
      if (!c) return;
      setConflict(null);
      const id = c.mine.id;
      if (keep === 'theirs') {
        if (c.theirs) {
          versions.current.set(id, c.theirs.version);
          setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? c.theirs!.project : p)) }));
        } else {
          versions.current.delete(id);
          setData((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== id) }));
        }
        toast('Showing the latest saved version');
      } else {
        if (c.theirs) versions.current.set(id, c.theirs.version);
        else versions.current.delete(id); // they deleted it: save mine as a new record
        const queued = queue.current.get(`p:${id}`);
        const latest = queued?.type === 'save' ? queued.project : (dataRef.current.projects.find((p) => p.id === id) ?? c.mine);
        enqueue(`p:${id}`, { type: 'save', project: latest });
      }
    },
    [conflict, enqueue, setData, toast],
  );

  // Live updates from teammates.
  useEffect(() => {
    const busy = (key: string) => queue.current.has(key) || inflight.current.has(key);
    const unsub = backend.subscribe((c: RemoteChange) => {
      if (c.table === 'projects') {
        const key = c.type === 'delete' ? `p:${c.id}` : `p:${c.project.id}`;
        if (busy(key)) return;
        if (c.type === 'delete') {
          if (!versions.current.has(c.id)) return;
          versions.current.delete(c.id);
          setData((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== c.id) }));
        } else {
          const known = versions.current.get(c.project.id) ?? 0;
          if (c.version <= known) return;
          versions.current.set(c.project.id, c.version);
          setData((d) => {
            const exists = d.projects.some((p) => p.id === c.project.id);
            return { ...d, projects: exists ? d.projects.map((p) => (p.id === c.project.id ? c.project : p)) : [c.project, ...d.projects] };
          });
        }
      } else {
        if (busy('s:settings') || (settingsVersion.current ?? 0) >= c.version) return;
        settingsVersion.current = c.version;
        setData((d) => ({ ...d, settings: { ...c.settings, numbering: { ...c.settings.numbering, nextQuote: Math.max(c.settings.numbering.nextQuote, d.settings.numbering.nextQuote), nextInvoice: Math.max(c.settings.numbering.nextInvoice, d.settings.numbering.nextInvoice), nextReceipt: Math.max(c.settings.numbering.nextReceipt, d.settings.numbering.nextReceipt) } } }));
      }
    });
    const online = () => [...queue.current.keys()].forEach((k) => void flush(k));
    // Backup for live updates: when you come back to the tab, quietly fetch teammates' latest changes.
    let lastRefresh = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 15000) return;
      if (queue.current.size + inflight.current.size > 0) return;
      lastRefresh = Date.now();
      void backend
        .load()
        .then((fresh) => {
          if (queue.current.size + inflight.current.size > 0) return;
          versions.current = new Map(fresh.projects.map((x) => [x.project.id, x.version]));
          settingsVersion.current = fresh.settingsVersion;
          setData(() => ({ settings: fresh.settings, projects: fresh.projects.map((x) => x.project) }));
        })
        .catch(() => {});
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      unsub();
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [backend, flush, setData]);

  const value: StoreValue = {
    data,
    backendKind: backend.kind,
    sync,
    upsertProject,
    deleteProject,
    updateSettings,
    replaceAll,
    takeNumber,
    clearDemo,
    resetEverything,
    reload,
    members: () => backend.members(),
    conflict,
    resolveConflict,
    toast,
    toastState,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}
