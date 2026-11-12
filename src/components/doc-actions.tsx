import { useRef } from 'react';
import { clientDisplayName } from '../lib/calc';
import { useStore } from '../lib/store';
import type { ClientPayment, InvoiceRecord, Project } from '../lib/types';
import { invoicePdf, quotationPdf, receiptPdf, revenuePdf } from '../pdf/documents';
import { safeFilePart } from '../pdf/output';
import { usePdf } from './pdf-preview';
import { Button } from './ui';

export type DocMode = 'preview' | 'download' | 'print';

export function useDocs() {
  const { data, upsertProject, takeNumber, toast } = useStore();
  const pdf = usePdf();
  const s = data.settings;
  const issuing = useRef(new Set<string>());

  const run = (mode: DocMode, build: () => ReturnType<typeof quotationPdf>, filename: string, title: string) => {
    if (mode === 'preview') pdf.preview(build, filename, title);
    else if (mode === 'download') pdf.download(build, filename);
    else pdf.print(build, filename);
  };

  return {
    quotation(p: Project, mode: DocMode = 'preview') {
      const name = `${p.quoteNumber || 'DRAFT'}-Quotation-${safeFilePart(clientDisplayName(p))}.pdf`;
      run(mode, () => quotationPdf(p, s), name, `Quotation ${p.quoteNumber || '(draft)'}`);
    },
    invoice(p: Project, inv: InvoiceRecord, mode: DocMode = 'preview') {
      run(mode, () => invoicePdf(p, s, inv), `${inv.number}-Invoice-${safeFilePart(clientDisplayName(p))}.pdf`, `Invoice ${inv.number}`);
    },
    /** Issues the receipt number the first time (never twice for the same payment), then builds the PDF. */
    async receipt(p: Project, pay: ClientPayment, mode: DocMode = 'preview') {
      if (pay.status !== 'verified') {
        toast('Mark the payment as received and verified before generating a receipt.', 'err');
        return;
      }
      let project = p;
      let payment = pay;
      if (!pay.receiptNumber) {
        if (issuing.current.has(pay.id)) return; // a receipt is already being issued for this payment
        issuing.current.add(pay.id);
        let number: string;
        try {
          number = await takeNumber('receipt');
        } catch (e) {
          toast(`Could not issue a receipt number: ${(e as Error).message}`, 'err');
          return;
        } finally {
          issuing.current.delete(pay.id);
        }
        payment = { ...pay, receiptNumber: number, receiptIssuedAt: new Date().toISOString() };
        project = { ...p, payments: p.payments.map((x) => (x.id === pay.id ? payment : x)) };
        upsertProject(project);
        toast(`Receipt ${number} issued`);
      }
      run(mode, () => receiptPdf(project, s, payment), `${payment.receiptNumber}-Receipt-${safeFilePart(clientDisplayName(p))}.pdf`, `Receipt ${payment.receiptNumber}`);
    },
    revenue(p: Project, mode: DocMode = 'preview') {
      run(mode, () => revenuePdf(p, s), `CONFIDENTIAL-Revenue-Breakdown-${p.quoteNumber || 'draft'}-${safeFilePart(clientDisplayName(p))}.pdf`, `Internal revenue breakdown — ${p.title}`);
    },
  };
}

/** Preview / Download / Print trio. */
export function DocButtons({ onRun, label, compact }: { onRun: (m: DocMode) => void; label?: string; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="mr-1 text-xs font-medium text-muted">{label}</span>}
      <Button size="sm" onClick={() => onRun('preview')}>
        {compact ? 'View' : 'Preview'}
      </Button>
      <Button size="sm" onClick={() => onRun('download')} title="Download PDF">
        {compact ? 'PDF' : 'Download'}
      </Button>
      <Button size="sm" onClick={() => onRun('print')} title="Print">
        Print
      </Button>
    </div>
  );
}
