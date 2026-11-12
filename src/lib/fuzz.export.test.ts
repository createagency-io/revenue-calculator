/**
 * Generates random projects, runs them through the app's real calculation engine and writes
 * inputs + outputs to JSON so an independent checker (scripts/oracle.py) can verify every figure.
 * Only writes a file when FUZZ_OUT is set; otherwise it just runs as a smoke test.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeTotals, distribution, maintenanceSummary, paymentSummary } from './calc';
import { defaultSettings } from './defaults';
import { blankProject } from './factory';
import type { Project } from './types';

// Small deterministic PRNG so runs are repeatable.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('fuzz export', () => {
  it('runs random projects through the engine', () => {
    const r = rng(20261031);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const s = defaultSettings();
    const cases: unknown[] = [];
    const N = Number(process.env.FUZZ_N ?? 3000);
    for (let i = 0; i < N; i++) {
      const p: Project = blankProject(s);
      const pkg = s.packages[int(0, s.packages.length - 1)];
      p.packageId = pkg.id;
      p.basePriceKobo = pkg.priceKobo ?? int(1, 500_000_000); // custom: up to ₦5m with random kobo
      p.lineItems = Array.from({ length: int(0, 6) }, (_, j) => ({
        id: `l${j}`,
        addonId: null,
        name: `item ${j}`,
        description: '',
        unitPriceKobo: r() < 0.5 ? int(0, 10_000) * 100 : int(0, 9_999_999), // whole naira or odd kobo
        qty: int(1, 25),
      }));
      const dt = int(0, 3);
      p.discount = {
        type: dt === 0 ? 'none' : dt === 1 ? 'amount' : 'percent',
        amountKobo: int(0, 60_000_000),
        bps: int(0, 10000),
        reason: 'x',
        approved: r() < 0.8,
        approvedBy: 'M',
      };
      p.depositBps = [5000, 5000, 5000, 3000, 4000, 6000, 3333, 7500][int(0, 7)];
      // random split in bps (two devs + agency), always summing to 10000
      if (r() < 0.6) {
        p.split = s.split.map((x) => ({ ...x }));
      } else {
        const a = int(0, 5000);
        const b = int(0, 10000 - a);
        p.split = [
          { ...s.split[0], bps: a },
          { ...s.split[1], bps: b },
          { ...s.split[2], bps: 10000 - a - b },
        ];
      }
      const t0 = computeTotals(p);
      // random payments: some verified, some pending, never above total (like the UI enforces)
      let room = t0.total;
      p.payments = Array.from({ length: int(0, 4) }, (_, j) => {
        const amt = room > 0 ? int(1, room) : 1;
        room = Math.max(room - amt, 0);
        return { id: `p${j}`, amountKobo: amt, date: '2026-10-01', method: 'Cash' as const, reference: '', note: '', status: r() < 0.75 ? ('verified' as const) : ('pending' as const), verifiedAt: null, receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: '' };
      }).filter((x) => x.amountKobo > 0);
      const mode = r();
      const mkPay = (id: string, amt: number, extra = {}) => ({ id, amountKobo: amt, date: '2026-10-01', method: 'Cash' as const, reference: '', note: '', status: 'verified' as const, verifiedAt: null, receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: '', ...extra });
      if (mode < 0.2 && t0.total > 0) p.payments = [mkPay('d', t0.deposit), ...(t0.delivery > 0 ? [mkPay('b', t0.delivery)] : [])]; // fully paid
      else if (mode < 0.27 && t0.total > 0) p.payments = [mkPay('o', t0.total + int(1, 500_000), { isOverpayment: true, note: 'refund owed' })]; // flagged overpayment
      p.commissionPayouts = [{ id: 'c', participantId: p.split[0].id, amountKobo: int(0, 1_000_000), date: '2026-10-01', method: '', note: '' }];
      p.expenses = Array.from({ length: int(0, 3) }, (_, j) => ({ id: `e${j}`, description: 'e', amountKobo: int(0, 5_000_000), date: '2026-10-01' }));
      const freq = (['monthly', 'quarterly', 'annually'] as const)[int(0, 2)];
      p.maintenance = { enabled: r() < 0.5, feeKobo: int(0, 20_000_000), frequency: freq, startDate: `2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, description: '', showOnQuote: true, payments: [{ id: 'm', amountKobo: int(0, 10_000_000), date: '2026-10-01', periodLabel: '', method: '', reference: '' }] };

      const t = computeTotals(p);
      const ps = paymentSummary(p, t);
      const d = distribution(p);
      const m = maintenanceSummary(p.maintenance, '2026-10-31');
      cases.push({
        input: { base: p.basePriceKobo, lines: p.lineItems.map((l) => [l.unitPriceKobo, l.qty]), discount: p.discount, depositBps: p.depositBps, split: p.split.map((x) => [x.id, x.bps, x.isAgency]), payments: p.payments.map((x) => [x.amountKobo, x.status]), payouts: p.commissionPayouts.map((c) => [c.participantId, c.amountKobo]), expenses: p.expenses.map((e) => e.amountKobo), maintenance: { enabled: p.maintenance.enabled, fee: p.maintenance.feeKobo, freq, start: p.maintenance.startDate, received: p.maintenance.payments.map((x) => x.amountKobo) } },
        output: { totals: t, payments: ps, shares: d.shares.map((x) => ({ id: x.id, amount: x.amount, earnedOnCash: x.earnedOnCash, paid: x.paid, unpaid: x.unpaid, dueNow: x.dueNow })), agencyAfterExpenses: d.agencyAfterExpenses, maintenance: m },
      });
      expect(d.reconciles).toBe(true);
    }
    if (process.env.FUZZ_OUT) writeFileSync(process.env.FUZZ_OUT, JSON.stringify(cases));
  });
});
