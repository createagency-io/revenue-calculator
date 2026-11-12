import { describe, expect, it } from 'vitest';
import { computeTotals, distribution, maintenanceSummary, nextDocNumber, paymentSummary, validatePayment, validateProject } from './calc';
import { defaultSettings } from './defaults';
import { demoData } from './demo';
import { blankProject, lineFromAddon } from './factory';
import { formatNaira, parseNaira, parsePercent, percentOf, splitByBps } from './money';
import type { Project } from './types';

const N = (n: number) => n * 100;
const s = defaultSettings();

function project(pkgId: string, over: (p: Project) => void = () => {}): Project {
  const p = blankProject(s);
  const pkg = s.packages.find((x) => x.id === pkgId)!;
  p.packageId = pkg.id;
  p.packageName = pkg.name;
  p.basePriceKobo = pkg.priceKobo ?? 0;
  p.client.fullName = 'Test Client';
  p.title = 'Test';
  over(p);
  return p;
}

function sumShares(p: Project) {
  return distribution(p).shares.reduce((a, b) => a + b.amount, 0);
}

describe('money helpers', () => {
  it('parses naira text into kobo without floating point', () => {
    expect(parseNaira('₦129,999')).toBe(12_999_900);
    expect(parseNaira('0.1')).toBe(10);
    expect(parseNaira('1,250.55')).toBe(125_055);
    expect(parseNaira('-5')).toBeNull();
    expect(parseNaira('1.234')).toBeNull();
    expect(parseNaira('abc')).toBeNull();
  });
  it('formats kobo', () => {
    expect(formatNaira(19_474_905)).toBe('₦194,749.05');
    expect(formatNaira(0)).toBe('₦0.00');
  });
  it('rounds percentages half-up to the kobo', () => {
    expect(percentOf(19_474_905, 5000)).toBe(9_737_453); // 9,737,452.5 -> up
    expect(percentOf(101, 5000)).toBe(51);
  });
  it('parses percentages', () => {
    expect(parsePercent('25')).toBe(2500);
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('101')).toBeNull();
  });
  it('split always reconciles to the exact total', () => {
    for (const total of [0, 1, 2, 3, 7, 101, 19_474_905, 99_999_999_999]) {
      const parts = splitByBps(total, s.split);
      expect(parts.reduce((a, b) => a + b.amount, 0)).toBe(total);
    }
  });
  it('rejects a split that does not add to 100%', () => {
    expect(() => splitByBps(100, [{ ...s.split[0], bps: 3000 }, s.split[1], s.split[2]])).toThrow();
  });
});

describe('required scenarios', () => {
  it('1. Starter package without add-ons', () => {
    const p = project('starter');
    const t = computeTotals(p);
    expect(t.total).toBe(N(99_999));
    expect(t.deposit).toBe(4_999_950);
    expect(t.delivery).toBe(4_999_950);
    const d = distribution(p);
    expect(d.shares.map((x) => x.amount)).toEqual([2_499_975, 2_499_975, 4_999_950]);
    expect(d.reconciles).toBe(true);
  });

  it('2. Business package with multiple add-ons', () => {
    const p = project('business', (p) => {
      p.lineItems = [lineFromAddon(s, 'page', 3), lineFromAddon(s, 'content', 11), lineFromAddon(s, 'booking')];
    });
    const t = computeTotals(p);
    expect(t.addons).toBe(N(45_000 + 110_000 + 40_000));
    expect(t.total).toBe(N(324_999));
    expect(t.deposit + t.delivery).toBe(t.total);
    expect(sumShares(p)).toBe(t.total);
  });

  it('2b. cannot charge for an add-on already included in the package', () => {
    const p = project('business', (p) => (p.lineItems = [lineFromAddon(s, 'whatsapp')]));
    expect(validateProject(p, s, []).join(' ')).toMatch(/already included/);
  });

  it('3. Custom project with manually entered price', () => {
    const p = project('custom');
    expect(validateProject(p, s, []).join(' ')).toMatch(/agreed price/);
    p.basePriceKobo = parseNaira('850,000')!;
    expect(validateProject(p, s, [])).toEqual([]);
    expect(computeTotals(p).total).toBe(N(850_000));
  });

  it('4. Discounted project (only applied once approved)', () => {
    const p = project('professional', (p) => {
      p.lineItems = [lineFromAddon(s, 'page', 2), lineFromAddon(s, 'revision')];
      p.discount = { type: 'percent', amountKobo: 0, bps: 1000, reason: 'Referral', approved: false, approvedBy: '' };
    });
    let t = computeTotals(p);
    expect(t.discount).toBe(0);
    expect(t.pendingDiscount).toBe(2_049_990);
    p.discount.approved = true;
    p.discount.approvedBy = 'Merlin';
    t = computeTotals(p);
    expect(t.subtotal).toBe(N(204_999));
    expect(t.discount).toBe(2_049_990);
    expect(t.total).toBe(18_449_910);
    expect(sumShares(p)).toBe(t.total);
  });

  it('4b. fixed-amount discount can never exceed the subtotal', () => {
    const p = project('starter', (p) => (p.discount = { type: 'amount', amountKobo: N(500_000), bps: 0, reason: 'x', approved: true, approvedBy: 'M' }));
    expect(computeTotals(p).total).toBe(0);
  });

  it('5. Partial client payment', () => {
    const p = project('custom', (p) => (p.basePriceKobo = N(850_000)));
    p.payments.push({ id: 'a', amountKobo: N(200_000), date: '2026-09-25', method: 'Bank transfer', reference: 'r', note: '', status: 'verified', verifiedAt: 'x', receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: '' });
    p.payments.push({ id: 'b', amountKobo: N(100_000), date: '2026-09-26', method: 'Bank transfer', reference: 'r', note: '', status: 'pending', verifiedAt: null, receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: '' });
    const ps = paymentSummary(p);
    expect(ps.verified).toBe(N(200_000)); // pending is NOT counted as received
    expect(ps.pending).toBe(N(100_000));
    expect(ps.outstanding).toBe(N(650_000));
    expect(ps.status).toBe('Partially paid');
    const d = distribution(p);
    expect(d.shares[0].earnedOnCash).toBe(N(50_000));
  });

  it('5b. blocks a payment larger than what is owed unless explicitly marked as overpayment', () => {
    const p = project('starter');
    const base = { id: 'n', amountKobo: N(100_000), isOverpayment: false, note: '', date: '2026-10-01' };
    expect(validatePayment(p, base)).toMatch(/more than the remaining balance/);
    expect(validatePayment(p, { ...base, isOverpayment: true })).toMatch(/note/);
    expect(validatePayment(p, { ...base, isOverpayment: true, note: 'Refund owed' })).toBeNull();
    expect(validatePayment(p, { ...base, amountKobo: 0 })).toMatch(/greater than/);
  });

  it('6. Fully paid project', () => {
    const p = project('starter');
    const t = computeTotals(p);
    for (const [id, amt] of [['a', t.deposit], ['b', t.delivery]] as const) {
      p.payments.push({ id, amountKobo: amt, date: '2026-10-01', method: 'Cash', reference: '', note: '', status: 'verified', verifiedAt: 'x', receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: '' });
    }
    const ps = paymentSummary(p);
    expect(ps.status).toBe('Fully paid');
    expect(ps.outstanding).toBe(0);
  });

  it('7. Receipt numbers are unique and never reused', () => {
    const d = demoData();
    const r = nextDocNumber(d.settings, d.projects, 'receipt');
    const used = d.projects.flatMap((p) => p.payments.map((x) => x.receiptNumber)).filter(Boolean);
    expect(used).not.toContain(r.number);
    expect(r.number).toBe('CRR-' + new Date().getFullYear() + '-0006');
  });

  it('8/10. Fractional kobo: deposit rounds, balance is the exact remainder, split reconciles', () => {
    const p = project('ecommerce', (p) => {
      p.lineItems = [lineFromAddon(s, 'page')];
      p.discount = { type: 'percent', amountKobo: 0, bps: 500, reason: 'Promo', approved: true, approvedBy: 'Merlin' };
    });
    const t = computeTotals(p);
    expect(t.total).toBe(19_474_905);
    expect(t.deposit).toBe(9_737_453);
    expect(t.delivery).toBe(9_737_452);
    const d = distribution(p);
    expect(d.shares.map((x) => x.amount)).toEqual([4_868_726, 4_868_726, 9_737_453]);
    expect(d.shares.reduce((a, b) => a + b.amount, 0)).toBe(t.total);
  });

  it('every demo project reconciles exactly', () => {
    for (const p of demoData().projects) {
      const d = distribution(p);
      expect(d.reconciles).toBe(true);
      expect(d.totals.deposit + d.totals.delivery).toBe(d.totals.total);
      expect(validateProject(p, demoData().settings, demoData().projects)).toEqual([]);
    }
  });
});

describe('maintenance', () => {
  it('is tracked separately and normalised', () => {
    const m = { enabled: true, feeKobo: N(60_000), frequency: 'quarterly' as const, startDate: '2026-01-10', description: '', showOnQuote: true, payments: [{ id: 'x', amountKobo: N(60_000), date: '2026-01-10', periodLabel: 'Q1', method: '', reference: '' }] };
    const r = maintenanceSummary(m, '2026-10-31');
    expect(r.monthly).toBe(N(20_000));
    expect(r.annual).toBe(N(240_000));
    expect(r.periodsBilled).toBe(4); // Jan, Apr, Jul, Oct
    expect(r.outstanding).toBe(N(180_000));
  });
  it('is not part of developer commission', () => {
    const p = project('starter');
    const before = distribution(p).shares.map((x) => x.amount);
    p.maintenance = { ...p.maintenance, enabled: true, feeKobo: N(15_000) };
    expect(distribution(p).shares.map((x) => x.amount)).toEqual(before);
  });
});
