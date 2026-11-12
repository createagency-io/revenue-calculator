import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoData } from '../lib/demo';
import type { Project } from '../lib/types';
import { invoicePdf, quotationPdf, receiptPdf, revenuePdf } from './documents';

const OUT = process.env.PDF_OUT ?? '';
const d = demoData();
const byId = (id: string) => d.projects.find((p) => p.id === id)!;

function save(name: string, buf: ArrayBuffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(buf));
}

describe('PDF documents', () => {
  it('generates all four documents for every demo project', () => {
    for (const p of d.projects) {
      const q = quotationPdf(p, d.settings).output('arraybuffer');
      save(`${p.id}-quotation`, q);
      const inv = p.invoices[0] ?? { number: p.invoiceNumber, issuedDate: p.issuedDate, dueDate: p.dueDate, label: 'Deposit (50%)', amountKobo: 100 };
      save(`${p.id}-invoice`, invoicePdf(p, d.settings, inv).output('arraybuffer'));
      const r = revenuePdf(p, d.settings).output('arraybuffer');
      save(`${p.id}-revenue`, r);
      const paid = p.payments.find((x) => x.status === 'verified' && x.receiptNumber);
      if (paid) save(`${p.id}-receipt`, receiptPdf(p, d.settings, paid).output('arraybuffer'));
      expect(q.byteLength).toBeGreaterThan(5000);
      expect(r.byteLength).toBeGreaterThan(5000);
    }
  });

  it('client documents never contain developer names or commission wording', () => {
    // Structural check: the client generators do not read split data at all.
    const src = quotationPdf.toString() + invoicePdf.toString() + receiptPdf.toString();
    expect(src).not.toMatch(/commission|payout|distribution\(|p\.split|developer/i);
  });

  it('refuses a receipt for a pending payment', () => {
    const p: Project = byId('demo_3');
    const pending = p.payments.find((x) => x.status === 'pending')!;
    expect(() => receiptPdf(p, d.settings, pending)).toThrow(/verified/);
  });

  it('long projects flow onto multiple pages', () => {
    const p: Project = JSON.parse(JSON.stringify(byId('demo_2')));
    for (let i = 0; i < 30; i++) p.lineItems.push({ ...p.lineItems[0], id: `x${i}`, name: `Extra landing page ${i + 1}` });
    const doc = quotationPdf(p, d.settings);
    save('multipage-quotation', doc.output('arraybuffer'));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
