import { addDays, todayISO, uid } from './calc';
import type { LineItem, Project, Settings } from './types';

export function blankProject(settings: Settings): Project {
  const today = todayISO();
  const pkg = settings.packages[0];
  return {
    id: uid('p_'),
    isDemo: false,
    quoteNumber: '',
    invoiceNumber: '',
    client: { fullName: '', business: '', email: '', phone: '' },
    title: '',
    description: '',
    packageId: pkg.id,
    packageName: pkg.name,
    basePriceKobo: pkg.priceKobo ?? 0,
    lineItems: [],
    discount: { type: 'none', amountKobo: 0, bps: 0, reason: '', approved: false, approvedBy: '' },
    startDate: today,
    expectedCompletion: addDays(today, 21),
    issuedDate: today,
    dueDate: addDays(today, settings.paymentTermsDays),
    quoteValidUntil: addDays(today, settings.quoteValidityDays),
    projectStatus: 'Quotation',
    payments: [],
    invoices: [],
    split: settings.split.map((s) => ({ ...s })),
    depositBps: settings.depositBps,
    commissionPayouts: [],
    expenses: [],
    maintenance: { enabled: false, feeKobo: 0, frequency: 'monthly', startDate: addDays(today, 30), description: 'Monthly website care: updates, backups, security checks and small content changes.', showOnQuote: true, payments: [] },
    scope: settings.defaultAssumptions,
    terms: settings.defaultTerms,
    internalNotes: '',
    clientNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function lineFromAddon(settings: Settings, addonId: string, qty = 1): LineItem {
  const a = settings.addons.find((x) => x.id === addonId)!;
  return { id: uid('li_'), addonId: a.id, name: a.name, description: a.description, unitPriceKobo: a.unitPriceKobo, qty };
}

/** Deep copy for "Duplicate quotation": new ids/numbers, no payments, invoices, payouts or expenses. */
export function duplicateProject(p: Project): Project {
  const today = todayISO();
  const copy: Project = JSON.parse(JSON.stringify(p));
  copy.id = uid('p_');
  copy.isDemo = false;
  copy.quoteNumber = '';
  copy.invoiceNumber = '';
  copy.title = `${p.title} (copy)`;
  copy.projectStatus = 'Quotation';
  copy.payments = [];
  copy.invoices = [];
  copy.commissionPayouts = [];
  copy.expenses = [];
  copy.maintenance.payments = [];
  copy.lineItems = copy.lineItems.map((l) => ({ ...l, id: uid('li_') }));
  copy.issuedDate = today;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  return copy;
}
