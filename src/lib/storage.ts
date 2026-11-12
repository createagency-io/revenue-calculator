import { defaultSettings } from './defaults';
import { demoData } from './demo';
import type { AppData, Project, Settings } from './types';

const KEY = 'create-agency-rms:v1';

export interface LoadResult {
  data: AppData;
  storageAvailable: boolean;
  firstRun: boolean;
  error: string | null;
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const t = '__create_test__';
    s.setItem(t, '1');
    s.removeItem(t);
    return s;
  } catch {
    return null;
  }
}

/** Fill in any settings keys added in later versions so old backups keep working. */
function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    company: { ...d.company, ...(saved.company ?? {}) },
    numbering: { ...d.numbering, ...(saved.numbering ?? {}) },
    pdf: { ...d.pdf, ...(saved.pdf ?? {}) },
    packages: saved.packages?.length ? saved.packages : d.packages,
    addons: saved.addons ?? d.addons,
    split: saved.split?.length ? saved.split : d.split,
    splitChangeLog: saved.splitChangeLog ?? [],
    version: 1,
  };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Basic structural check of imported data. Returns a list of problems (empty = OK). */
export function validateAppData(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== 'object') return ['File is not a C.R.E.A.T.E. backup.'];
  const d = raw as Partial<AppData> & { app?: string };
  if (!d.settings || typeof d.settings !== 'object') errs.push('Missing settings.');
  if (!Array.isArray(d.projects)) errs.push('Missing projects list.');
  (d.projects ?? []).forEach((p: Project, i) => {
    const label = `Project ${i + 1}`;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') return errs.push(`${label}: missing id.`);
    if (!isInt(p.basePriceKobo) || p.basePriceKobo < 0) errs.push(`${label}: invalid package price.`);
    if (!Array.isArray(p.lineItems) || p.lineItems.some((l) => !isInt(l.unitPriceKobo) || l.unitPriceKobo < 0 || !Number.isInteger(l.qty) || l.qty < 0)) errs.push(`${label}: invalid services.`);
    if (!Array.isArray(p.payments) || p.payments.some((x) => !isInt(x.amountKobo) || x.amountKobo <= 0)) errs.push(`${label}: invalid payments.`);
    if (!Array.isArray(p.split) || p.split.reduce((s, x) => s + (x.bps ?? 0), 0) !== 10000) errs.push(`${label}: revenue split does not add up to 100%.`);
  });
  return errs;
}

/** Fill in project fields added in later versions. */
function normaliseProject(p: Project): Project {
  return {
    ...p,
    invoices: p.invoices ?? [],
    commissionPayouts: p.commissionPayouts ?? [],
    expenses: p.expenses ?? [],
    maintenance: { ...{ enabled: false, feeKobo: 0, frequency: 'monthly' as const, startDate: '', description: '', showOnQuote: true, payments: [] }, ...(p.maintenance ?? {}) },
  };
}

export function loadData(): LoadResult {
  const s = storage();
  if (!s) return { data: demoData(), storageAvailable: false, firstRun: true, error: 'Browser storage is blocked here, so nothing will be saved. Export a backup before closing.' };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { data: demoData(), storageAvailable: true, firstRun: true, error: null };
    const parsed = JSON.parse(raw);
    const errs = validateAppData(parsed);
    if (errs.length) throw new Error(errs.join(' '));
    return { data: { settings: mergeSettings(parsed.settings), projects: parsed.projects.map(normaliseProject) }, storageAvailable: true, firstRun: false, error: null };
  } catch (e) {
    return { data: demoData(), storageAvailable: true, firstRun: true, error: `Saved data could not be read (${(e as Error).message}). Demo data was loaded instead. Your old data is still in the browser until you save.` };
  }
}

export function saveData(data: AppData): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function importAppData(text: string): { data: AppData | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { data: null, errors: ['That file is not valid JSON.'] };
  }
  const errors = validateAppData(parsed);
  if (errors.length) return { data: null, errors };
  const d = parsed as AppData;
  return { data: { settings: mergeSettings(d.settings), projects: d.projects.map(normaliseProject) }, errors: [] };
}

export function exportAppData(data: AppData): string {
  return JSON.stringify({ app: 'C.R.E.A.T.E. Revenue Calculator', exportedAt: new Date().toISOString(), ...data }, null, 2);
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
