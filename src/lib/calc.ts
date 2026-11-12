import { BPS_100, assertKobo, formatNaira, percentOf, splitByBps, type Kobo, type SplitResult } from './money';
import type { ClientPayment, Maintenance, MaintenanceFrequency, Project, Settings } from './types';

/* ---------------------------------------------------------------- dates */

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

export function uid(prefix = ''): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/* ---------------------------------------------------------- line totals */

export function lineTotal(unitPriceKobo: Kobo, qty: number): Kobo {
  assertKobo(unitPriceKobo, 'unit price');
  if (!Number.isInteger(qty) || qty < 0) throw new Error('Quantity must be a whole number, 0 or more');
  if (unitPriceKobo < 0) throw new Error('Prices cannot be negative');
  return assertKobo(unitPriceKobo * qty, 'line total');
}

export interface Totals {
  base: Kobo;
  addons: Kobo;
  subtotal: Kobo;
  discount: Kobo; // applied (approved) discount
  pendingDiscount: Kobo; // discount entered but NOT approved (not applied)
  total: Kobo;
  deposit: Kobo;
  delivery: Kobo;
}

export function computeTotals(p: Pick<Project, 'basePriceKobo' | 'lineItems' | 'discount' | 'depositBps'>): Totals {
  const base = assertKobo(p.basePriceKobo, 'package price');
  if (base < 0) throw new Error('Package price cannot be negative');
  const addons = p.lineItems.reduce((s, li) => s + lineTotal(li.unitPriceKobo, li.qty), 0);
  const subtotal = base + addons;
  let raw = 0;
  if (p.discount.type === 'amount') raw = Math.min(Math.max(p.discount.amountKobo, 0), subtotal);
  if (p.discount.type === 'percent') raw = percentOf(subtotal, Math.min(Math.max(p.discount.bps, 0), BPS_100));
  const discount = p.discount.approved ? raw : 0;
  const total = subtotal - discount;
  const deposit = percentOf(total, p.depositBps);
  return { base, addons, subtotal, discount, pendingDiscount: p.discount.approved ? 0 : raw, total, deposit, delivery: total - deposit };
}

/* ------------------------------------------------------------- payments */

export type PaymentStatus = 'Unpaid' | 'Partially paid' | 'Deposit paid' | 'Fully paid' | 'Overpaid' | 'No charge';

export interface PaymentSummary {
  verified: Kobo;
  pending: Kobo;
  outstanding: Kobo;
  overpaid: Kobo;
  status: PaymentStatus;
  depositOutstanding: Kobo;
}

export function verifiedPayments(p: Project): ClientPayment[] {
  return p.payments.filter((x) => x.status === 'verified');
}

export function paymentSummary(p: Project, totals = computeTotals(p)): PaymentSummary {
  const verified = verifiedPayments(p).reduce((s, x) => s + x.amountKobo, 0);
  const pending = p.payments.filter((x) => x.status === 'pending').reduce((s, x) => s + x.amountKobo, 0);
  const outstanding = Math.max(totals.total - verified, 0);
  const overpaid = Math.max(verified - totals.total, 0);
  let status: PaymentStatus;
  if (totals.total === 0) status = 'No charge';
  else if (overpaid > 0) status = 'Overpaid';
  else if (verified === totals.total) status = 'Fully paid';
  else if (verified === 0) status = 'Unpaid';
  else if (verified >= totals.deposit) status = 'Deposit paid';
  else status = 'Partially paid';
  return { verified, pending, outstanding, overpaid, status, depositOutstanding: Math.max(totals.deposit - verified, 0) };
}

/**
 * Validates a new (or edited) client payment.
 * The amount may not exceed what is still owed (counting other pending payments too),
 * unless the person explicitly ticks the overpayment box AND writes a note.
 */
export function validatePayment(p: Project, pay: Pick<ClientPayment, 'id' | 'amountKobo' | 'isOverpayment' | 'note' | 'date'>): string | null {
  if (!Number.isSafeInteger(pay.amountKobo) || pay.amountKobo <= 0) return 'Enter a payment amount greater than ₦0.';
  if (!pay.date) return 'Enter the payment date.';
  const totals = computeTotals(p);
  const others = p.payments.filter((x) => x.id !== pay.id).reduce((s, x) => s + x.amountKobo, 0);
  const room = Math.max(totals.total - others, 0);
  if (pay.amountKobo > room) {
    if (!pay.isOverpayment) return `This is more than the remaining balance (${formatNaira(room)} after other recorded payments). Tick "Record as overpayment" and add a note if the client really paid more.`;
    if (!pay.note.trim()) return 'Add a note explaining the overpayment (for example: refund owed, or credit toward maintenance).';
  }
  return null;
}

/* ------------------------------------------------------ revenue sharing */

export interface ShareRow extends SplitResult {
  paid: Kobo;
  unpaid: Kobo; // allocation − paid
  earnedOnCash: Kobo; // share of cash actually collected
  dueNow: Kobo; // earnedOnCash − paid (never below 0)
}

export interface Distribution {
  totals: Totals;
  payments: PaymentSummary;
  shares: ShareRow[];
  developerAllocation: Kobo;
  developerPaid: Kobo;
  agencyAllocation: Kobo;
  expenses: Kobo;
  agencyAfterExpenses: Kobo;
  reconciles: boolean;
}

export function distribution(p: Project): Distribution {
  const totals = computeTotals(p);
  const payments = paymentSummary(p, totals);
  const alloc = splitByBps(totals.total, p.split);
  const cash = Math.min(payments.verified, totals.total); // overpayments are not shared
  const onCash = splitByBps(cash, p.split);
  const shares: ShareRow[] = alloc.map((a, i) => {
    const paid = p.commissionPayouts.filter((c) => c.participantId === a.id).reduce((s, c) => s + c.amountKobo, 0);
    const earnedOnCash = onCash[i].amount;
    return { ...a, paid, unpaid: a.amount - paid, earnedOnCash, dueNow: Math.max(earnedOnCash - paid, 0) };
  });
  const devs = shares.filter((s) => !s.isAgency);
  const agency = shares.find((s) => s.isAgency)!;
  const expenses = p.expenses.reduce((s, e) => s + e.amountKobo, 0);
  return {
    totals,
    payments,
    shares,
    developerAllocation: devs.reduce((s, d) => s + d.amount, 0),
    developerPaid: devs.reduce((s, d) => s + d.paid, 0),
    agencyAllocation: agency.amount,
    expenses,
    agencyAfterExpenses: agency.amount - expenses,
    reconciles: shares.reduce((s, r) => s + r.amount, 0) === totals.total,
  };
}

/* ---------------------------------------------------------- maintenance */

export const PERIODS_PER_YEAR: Record<MaintenanceFrequency, number> = { monthly: 12, quarterly: 4, annually: 1 };
const MONTHS_PER_PERIOD: Record<MaintenanceFrequency, number> = { monthly: 1, quarterly: 3, annually: 12 };

export function monthsBetween(startISO: string, endISO: string): number {
  const [y1, m1, d1] = startISO.split('-').map(Number);
  const [y2, m2, d2] = endISO.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months -= 1;
  return months;
}

export interface MaintenanceSummary {
  active: boolean;
  monthly: Kobo; // monthly-equivalent recurring revenue (rounded to kobo)
  annual: Kobo; // exact annualised estimate
  periodsBilled: number;
  billedToDate: Kobo;
  received: Kobo;
  outstanding: Kobo;
  status: 'Not active' | 'Not started' | 'Up to date' | 'Payment due' | 'Paid ahead';
}

export function maintenanceSummary(m: Maintenance, asOf = todayISO()): MaintenanceSummary {
  const received = m.payments.reduce((s, x) => s + x.amountKobo, 0);
  if (!m.enabled || m.feeKobo <= 0) {
    return { active: false, monthly: 0, annual: 0, periodsBilled: 0, billedToDate: 0, received, outstanding: 0, status: 'Not active' };
  }
  const annual = m.feeKobo * PERIODS_PER_YEAR[m.frequency];
  const monthly = Math.round(annual / 12); // display figure only; integer kobo
  let periodsBilled = 0;
  if (m.startDate && m.startDate <= asOf) periodsBilled = Math.floor(monthsBetween(m.startDate, asOf) / MONTHS_PER_PERIOD[m.frequency]) + 1;
  const billedToDate = periodsBilled * m.feeKobo;
  const outstanding = Math.max(billedToDate - received, 0);
  let status: MaintenanceSummary['status'] = 'Up to date';
  if (periodsBilled === 0) status = 'Not started';
  else if (outstanding > 0) status = 'Payment due';
  else if (received > billedToDate) status = 'Paid ahead';
  return { active: true, monthly, annual, periodsBilled, billedToDate, received, outstanding, status };
}

/* ------------------------------------------------------------ numbering */

export function formatDocNumber(prefix: string, n: number, includeYear: boolean, year = new Date().getFullYear()): string {
  return includeYear ? `${prefix}-${year}-${String(n).padStart(4, '0')}` : `${prefix}-${String(n).padStart(4, '0')}`;
}

export type DocKind = 'quote' | 'invoice' | 'receipt';

/** Returns the next unused number of a kind and the counter value to store back into settings. */
export function nextDocNumber(settings: Settings, projects: Project[], kind: DocKind): { number: string; next: number } {
  const n = settings.numbering;
  const prefix = kind === 'quote' ? n.quotePrefix : kind === 'invoice' ? n.invoicePrefix : n.receiptPrefix;
  let counter = kind === 'quote' ? n.nextQuote : kind === 'invoice' ? n.nextInvoice : n.nextReceipt;
  const used = new Set<string>();
  for (const p of projects) {
    used.add(p.quoteNumber);
    used.add(p.invoiceNumber);
    p.invoices.forEach((i) => used.add(i.number));
    p.payments.forEach((x) => x.receiptNumber && used.add(x.receiptNumber));
  }
  let num = formatDocNumber(prefix, counter, n.includeYear);
  while (used.has(num)) {
    counter += 1;
    num = formatDocNumber(prefix, counter, n.includeYear);
  }
  return { number: num, next: counter + 1 };
}

/** Which add-ons are already part of a package (can't be charged twice). */
export function includedAddonIds(settings: Settings, packageId: string): Set<string> {
  return new Set(settings.packages.find((p) => p.id === packageId)?.includedAddonIds ?? []);
}

/** Problems that should block saving a project. */
export function validateProject(p: Project, settings: Settings, all: Project[]): string[] {
  const errs: string[] = [];
  if (!p.client.fullName.trim() && !p.client.business.trim()) errs.push('Enter the client name or business name.');
  if (!p.title.trim()) errs.push('Enter a project title.');
  if (!Number.isSafeInteger(p.basePriceKobo) || p.basePriceKobo < 0) errs.push('Package price must be ₦0 or more.');
  const pkg = settings.packages.find((x) => x.id === p.packageId);
  if (pkg && pkg.priceKobo === null && p.basePriceKobo <= 0) errs.push('Premium / Custom needs the agreed price entered after consultation.');
  const included = includedAddonIds(settings, p.packageId);
  p.lineItems.forEach((li, i) => {
    if (!li.name.trim()) errs.push(`Service #${i + 1} needs a name.`);
    if (!Number.isSafeInteger(li.unitPriceKobo) || li.unitPriceKobo < 0) errs.push(`"${li.name || 'Service'}" has an invalid price.`);
    if (!Number.isInteger(li.qty) || li.qty < 1) errs.push(`"${li.name || 'Service'}" needs a quantity of at least 1.`);
    if (li.addonId && included.has(li.addonId) && li.unitPriceKobo > 0) errs.push(`"${li.name}" is already included in the ${p.packageName} package — remove it or set its price to ₦0.`);
  });
  if (p.discount.type !== 'none') {
    if (p.discount.type === 'amount' && (!Number.isSafeInteger(p.discount.amountKobo) || p.discount.amountKobo < 0)) errs.push('Discount amount is invalid.');
    if (p.discount.approved && !p.discount.approvedBy.trim()) errs.push('Enter who approved the discount.');
  }
  if (p.split.reduce((s, x) => s + x.bps, 0) !== BPS_100) errs.push('Revenue split must add up to exactly 100%.');
  const dupQuote = all.find((o) => o.id !== p.id && p.quoteNumber && o.quoteNumber === p.quoteNumber);
  if (dupQuote) errs.push(`Quotation number ${p.quoteNumber} is already used.`);
  const dupInv = all.find((o) => o.id !== p.id && p.invoiceNumber && o.invoiceNumber === p.invoiceNumber);
  if (dupInv) errs.push(`Invoice number ${p.invoiceNumber} is already used.`);
  if (p.expectedCompletion && p.startDate && p.expectedCompletion < p.startDate) errs.push('Expected completion is before the start date.');
  try {
    computeTotals(p);
  } catch (e) {
    errs.push((e as Error).message);
  }
  return errs;
}

export function clientDisplayName(p: Project): string {
  return p.client.business.trim() || p.client.fullName.trim() || 'Unnamed client';
}

/** What is still owed on one invoice: its amount minus verified payments recorded against it, capped by the project balance. */
export function invoiceDue(p: Project, inv: { number: string; amountKobo: Kobo }): { paidOnInvoice: Kobo; due: Kobo } {
  const paidOnInvoice = p.payments.filter((x) => x.status === 'verified' && x.invoiceNumber === inv.number).reduce((s, x) => s + x.amountKobo, 0);
  const due = Math.min(Math.max(inv.amountKobo - paidOnInvoice, 0), paymentSummary(p).outstanding);
  return { paidOnInvoice, due };
}
