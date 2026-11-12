import type { jsPDF } from 'jspdf';
import type { RowInput } from 'jspdf-autotable';
import { clientDisplayName, computeTotals, distribution, formatDate, invoiceDue, maintenanceSummary, paymentSummary } from '../lib/calc';
import { bpsToPercentText } from '../lib/money';
import type { ClientPayment, InvoiceRecord, Project, Settings } from '../lib/types';
import { CONTENT_W, CREAM2, ESPRESSO, INK, M, MUTED, PdfBuilder, RED, type RGB } from './base';

const FREQ_LABEL = { monthly: 'per month', quarterly: 'per quarter', annually: 'per year' } as const;

function clientLines(p: Project): [string, string][] {
  return [
    ['Name', p.client.fullName],
    ['Business', p.client.business],
    ['Email', p.client.email],
    ['Phone', p.client.phone],
  ].filter(([, v]) => v.trim()) as [string, string][];
}

/** Itemised charges, shared by the quotation and the invoice (client-facing — no commission data). */
function chargesTable(b: PdfBuilder, p: Project, settings: Settings) {
  const pkg = settings.packages.find((x) => x.id === p.packageId);
  const inclusions = pkg?.inclusions?.length ? `Includes: ${pkg.inclusions.join(' · ')}` : '';
  const isCustom = pkg?.priceKobo === null;
  const body: RowInput[] = [
    [
      '1',
      { content: `${p.packageName} website package${isCustom ? ' (agreed after consultation)' : ''}${inclusions ? `\n${inclusions}` : ''}`, styles: { fontStyle: 'normal' } },
      '1',
      b.money(p.basePriceKobo),
      b.money(p.basePriceKobo),
    ],
    ...p.lineItems.map((li, i) => [
      String(i + 2),
      `${li.name}${li.description ? `\n${li.description}` : ''}`,
      String(li.qty),
      b.money(li.unitPriceKobo),
      b.money(li.unitPriceKobo * li.qty),
    ]),
  ];
  b.table({
    head: [['#', 'Description', 'Qty', 'Unit price', 'Amount']],
    body,
    columnStyles: {
      0: { cellWidth: 8, textColor: MUTED },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    headStyles: { halign: 'left' },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 3) data.cell.styles.halign = 'right';
      if (data.section === 'head' && data.column.index === 2) data.cell.styles.halign = 'center';
    },
  });
}

function discountRow(b: PdfBuilder, p: Project, totalsDiscount: number) {
  if (totalsDiscount <= 0) return [];
  const label = p.discount.type === 'percent' ? `Discount (${bpsToPercentText(p.discount.bps)})` : 'Discount';
  return [{ label, value: `−${b.money(totalsDiscount)}`, note: p.discount.reason || undefined }];
}

/* =============================================================== A. QUOTATION */

export function quotationPdf(p: Project, settings: Settings): jsPDF {
  const t = computeTotals(p);
  const b = new PdfBuilder(settings, {
    title: 'QUOTATION',
    number: p.quoteNumber || 'DRAFT',
    meta: [
      ['Date issued', formatDate(p.issuedDate)],
      ['Valid until', formatDate(p.quoteValidUntil)],
    ],
  });
  b.infoColumns([
    { title: 'Prepared for', lines: clientLines(p) },
    {
      title: 'Project',
      lines: [
        ['Title', p.title],
        ['Package', p.packageName],
        ['Start', formatDate(p.startDate)],
        ['Completion', formatDate(p.expectedCompletion)],
      ],
    },
  ]);
  if (p.description.trim()) {
    b.sectionTitle('Project description');
    b.paragraph(p.description);
    b.gap(1);
  }
  b.sectionTitle('Itemised charges');
  chargesTable(b, p, settings);
  const depPct = bpsToPercentText(p.depositBps);
  const balPct = bpsToPercentText(10000 - p.depositBps);
  b.totals([
    { label: 'Package', value: b.money(t.base), muted: true },
    { label: 'Additional services', value: b.money(t.addons), muted: true },
    { label: 'Subtotal', value: b.money(t.subtotal) },
    ...discountRow(b, p, t.discount),
    { label: 'Total project fee', value: b.money(t.total), strong: true },
    { label: `Deposit (${depPct})`, value: b.money(t.deposit), note: 'Due before work begins' },
    { label: `Balance (${balPct})`, value: b.money(t.delivery), note: 'Due on delivery' },
  ]);

  const m = p.maintenance;
  if (m.enabled && m.showOnQuote && m.feeKobo > 0) {
    b.callout(
      'Optional website maintenance',
      `${m.description || 'Ongoing website care.'} Billed ${m.frequency} from ${formatDate(m.startDate)}. This is optional, billed separately and NOT included in the total project fee above.`,
      { bigValue: `${b.money(m.feeKobo)} ${FREQ_LABEL[m.frequency]}` },
    );
  }

  if (p.scope.trim()) {
    b.sectionTitle('Project scope and assumptions');
    b.bullets(p.scope.split('\n'));
    b.gap(2);
  }
  if (p.terms.trim()) {
    b.sectionTitle('Terms and conditions');
    b.bullets(p.terms.split('\n'), true);
    b.gap(2);
  }
  if (p.clientNotes.trim()) {
    b.sectionTitle('Notes');
    b.paragraph(p.clientNotes);
  }
  b.callout('Payment', settings.paymentInstructionsNote, { tone: 'accent' });
  b.paragraph(`Prices are in Nigerian Naira (NGN). All charges are listed above — there are no hidden fees. This quotation is valid until ${formatDate(p.quoteValidUntil)}.`, 8.5, MUTED);
  return b.finish();
}

/* ================================================================= B. INVOICE */

export function invoicePdf(p: Project, settings: Settings, inv: InvoiceRecord): jsPDF {
  const t = computeTotals(p);
  const ps = paymentSummary(p, t);
  const b = new PdfBuilder(settings, {
    title: 'INVOICE',
    number: inv.number,
    meta: [
      ['Issue date', formatDate(inv.issuedDate)],
      ['Due date', formatDate(inv.dueDate)],
      ['Quotation', p.quoteNumber || '—'],
    ],
  });
  b.infoColumns([
    { title: 'Bill to', lines: clientLines(p) },
    {
      title: 'Project',
      lines: [
        ['Title', p.title],
        ['Package', p.packageName],
        ['Status', ps.status],
      ],
    },
  ]);

  // The installment being requested — shown first and clearly separated from the full value.
  const amountDue = invoiceDue(p, inv).due;
  b.callout(
    `Amount due on this invoice — ${inv.label}`,
    amountDue < inv.amountKobo
      ? `Invoice amount ${b.money(inv.amountKobo)}, less ${b.money(inv.amountKobo - amountDue)} already received against it. This is the installment currently requested, not the full project value. Please pay by ${formatDate(inv.dueDate)}.`
      : `This is the installment currently requested, not the full project value. Please pay by ${formatDate(inv.dueDate)}.`,
    { tone: 'accent', bigValue: b.money(amountDue) },
  );

  b.sectionTitle('Itemised charges (full project)');
  chargesTable(b, p, settings);
  b.totals([
    { label: 'Subtotal', value: b.money(t.subtotal) },
    ...discountRow(b, p, t.discount),
    { label: 'Total agreed project cost', value: b.money(t.total), strong: true },
    { label: 'Amount already paid', value: ps.verified > 0 ? `−${b.money(ps.verified)}` : b.money(0), note: ps.pending > 0 ? `${b.money(ps.pending)} awaiting confirmation (not yet counted)` : undefined },
    { label: 'Outstanding balance', value: b.money(ps.outstanding) },
    { label: 'Current amount due (this invoice)', value: b.money(amountDue) },
  ]);

  const paid = p.payments.filter((x) => x.status === 'verified');
  if (paid.length) {
    b.sectionTitle('Payments received');
    b.table({
      head: [['Date', 'Receipt no.', 'Method', 'Reference', 'Amount']],
      body: paid.map((x) => [formatDate(x.date), x.receiptNumber ?? '—', x.method, x.reference || '—', b.money(x.amountKobo)]),
      columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } },
    });
  }
  b.infoColumns([
    {
      title: 'Payment status',
      lines: [
        ['Status', ps.status],
        ['Paid so far', b.money(ps.verified)],
        ['Still owed', b.money(ps.outstanding)],
      ],
    },
    {
      title: 'Payment schedule',
      lines: [
        [`Deposit`, `${b.money(t.deposit)} (${bpsToPercentText(p.depositBps)})`],
        ['On delivery', `${b.money(t.delivery)} (${bpsToPercentText(10000 - p.depositBps)})`],
      ],
    },
  ]);
  if (p.clientNotes.trim()) {
    b.sectionTitle('Notes');
    b.paragraph(p.clientNotes);
  }
  b.callout('How to pay', settings.paymentInstructionsNote + ' Please quote the invoice number with your payment.', { tone: 'cream' });
  return b.finish();
}

/* ================================================================= C. RECEIPT */

export function receiptPdf(p: Project, settings: Settings, pay: ClientPayment): jsPDF {
  if (pay.status !== 'verified') throw new Error('Receipts can only be generated for payments marked as received and verified.');
  if (!pay.receiptNumber) throw new Error('This payment has no receipt number yet.');
  const t = computeTotals(p);
  const verified = p.payments.filter((x) => x.status === 'verified');
  const idx = verified.findIndex((x) => x.id === pay.id);
  // Cumulative = all verified payments dated on/before this one (ties: recorded order).
  const cumulative = verified.filter((x, i) => x.date < pay.date || (x.date === pay.date && i <= idx)).reduce((s, x) => s + x.amountKobo, 0);
  const remaining = Math.max(t.total - cumulative, 0);

  const b = new PdfBuilder(settings, {
    title: 'RECEIPT',
    number: pay.receiptNumber,
    meta: [
      ['Payment date', formatDate(pay.date)],
      ['Invoice', pay.invoiceNumber || p.invoiceNumber || '—'],
      ['Issued', formatDate((pay.receiptIssuedAt ?? new Date().toISOString()).slice(0, 10))],
    ],
  });
  b.callout('Payment received', `Thank you. We confirm that ${b.money(pay.amountKobo)} was received from ${clientDisplayName(p)} for "${p.title}" and has been verified.`, { tone: 'accent', bigValue: b.money(pay.amountKobo) });
  b.infoColumns([
    { title: 'Received from', lines: clientLines(p) },
    {
      title: 'Payment details',
      lines: [
        ['Amount', b.money(pay.amountKobo)],
        ['Date', formatDate(pay.date)],
        ['Method', pay.method],
        ['Reference', pay.reference || '—'],
      ],
    },
  ]);
  b.sectionTitle('Project account');
  b.table({
    body: [
      ['Project', `${p.title} — ${p.packageName} package`],
      ['Total project value', b.money(t.total)],
      ['This payment', b.money(pay.amountKobo)],
      ['Total paid to date (including this payment)', b.money(cumulative)],
      ['Remaining balance', b.money(remaining)],
    ],
    columnStyles: { 0: { textColor: MUTED, cellWidth: 90 }, 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => {
      if (d.row.index === 4) {
        d.cell.styles.fillColor = CREAM2;
        d.cell.styles.fontSize = 10.5;
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  if (pay.isOverpayment && pay.note) b.callout('Note on this payment', pay.note);
  b.paragraph(remaining === 0 ? 'This project is now fully paid. Thank you for your business.' : `A balance of ${b.money(remaining)} remains on this project.`, 9.5, ESPRESSO);
  b.paragraph('This receipt confirms a payment that C.R.E.A.T.E. Agency has received and verified. Please keep it for your records.', 8.5, MUTED);
  return b.finish();
}

/* ========================================== D. INTERNAL REVENUE DISTRIBUTION */

export function revenuePdf(p: Project, settings: Settings): jsPDF {
  const d = distribution(p);
  const t = d.totals;
  const ps = d.payments;
  const b = new PdfBuilder(settings, {
    title: 'REVENUE REPORT',
    number: p.quoteNumber || p.id,
    confidential: true,
    heading: 'C.R.E.A.T.E. AGENCY — PROJECT REVENUE DISTRIBUTION',
    meta: [
      ['Generated', formatDate(new Date().toISOString().slice(0, 10))],
      ['Invoice', p.invoiceNumber || '—'],
      ['Project status', p.projectStatus],
    ],
  });

  b.sectionTitle('Project information');
  const addonsText = p.lineItems.length ? p.lineItems.map((l) => `${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''} (${b.money(l.unitPriceKobo * l.qty)})`).join('\n') : 'None';
  const half = (rows: [string, string][]) => rows;
  b.table({
    body: half([
      ['Client name', p.client.fullName || '—'],
      ['Business name', p.client.business || '—'],
      ['Project title', p.title],
      ['Selected package', p.packageName],
      ['Package base price', b.money(t.base)],
      ['Additional services', addonsText],
      ['Discounts', t.discount > 0 ? `−${b.money(t.discount)}${p.discount.reason ? ` (${p.discount.reason}; approved by ${p.discount.approvedBy})` : ''}` : t.pendingDiscount > 0 ? `None applied (${b.money(t.pendingDiscount)} awaiting approval)` : 'None'],
      ['Total project fee', b.money(t.total)],
      [`Deposit (${bpsToPercentText(p.depositBps)})`, b.money(t.deposit)],
      ['Amount received (verified)', b.money(ps.verified)],
      ['Outstanding client balance', b.money(ps.outstanding)],
      ['Payment status', ps.status + (ps.pending ? ` · ${b.money(ps.pending)} pending verification` : '')],
    ]),
    columnStyles: { 0: { cellWidth: 62, textColor: MUTED }, 1: { fontStyle: 'bold' } },
    didParseCell: (c) => {
      if (c.row.index === 7) {
        c.cell.styles.fillColor = CREAM2;
        c.cell.styles.fontSize = 10.5;
      }
    },
  });

  b.ensure(70);
  b.sectionTitle('Revenue distribution');
  b.table({
    head: [['Party', 'Role', 'Share', 'Allocation', 'Earned on cash', 'Paid', 'Unpaid balance']],
    body: d.shares.map((s) => [s.name, s.role, bpsToPercentText(s.bps), b.money(s.amount), b.money(s.earnedOnCash), s.isAgency ? '—' : b.money(s.paid), s.isAgency ? '—' : b.money(s.unpaid)]),
    foot: [['Total', '', '100%', b.money(d.shares.reduce((a, s) => a + s.amount, 0)), b.money(d.shares.reduce((a, s) => a + s.earnedOnCash, 0)), b.money(d.developerPaid), b.money(d.developerAllocation - d.developerPaid)]],
    styles: { fontSize: 8.6 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 }, 2: { halign: 'center', cellWidth: 14 }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didParseCell: (c) => {
      if ((c.section === 'head' || c.section === 'foot') && c.column.index >= 3) c.cell.styles.halign = 'right';
      if ((c.section === 'head' || c.section === 'foot') && c.column.index === 2) c.cell.styles.halign = 'center';
    },
  });

  // Visual percentage bar
  b.ensure(22);
  const palette: RGB[] = [ESPRESSO, [111, 104, 98], b.accent];
  let x = M;
  const barY = b.y;
  d.shares.forEach((s, i) => {
    const w = (CONTENT_W * s.bps) / 10000;
    const col = s.isAgency ? b.accent : palette[i % 2];
    b.doc.setFillColor(...col);
    b.doc.rect(x, barY, w, 9, 'F');
    b.font(8.5, 'bold', [255, 255, 255]);
    if (w > 22) b.doc.text(`${s.name} ${bpsToPercentText(s.bps)}`, x + w / 2, barY + 5.8, { align: 'center' });
    x += w;
  });
  b.y = barY + 14;
  b.font(7.8, 'normal', MUTED);
  b.doc.text('"Earned on cash" is each share of the money actually collected so far (overpayments excluded). "Unpaid balance" = allocation − commission paid.', M, b.y);
  b.y += 7;

  b.ensure(80);
  b.sectionTitle('Financial details');
  const unpaidCommission = d.developerAllocation - d.developerPaid;
  b.table({
    body: [
      ['Total contracted project revenue', b.money(t.total)],
      ['Actual cash collected (verified)', b.money(ps.verified)],
      ['Total commission allocations', b.money(d.developerAllocation)],
      ['Commission amounts already paid', b.money(d.developerPaid)],
      ['Unpaid commission balances', b.money(unpaidCommission)],
      ['Commission currently due on cash collected', b.money(d.shares.filter((s) => !s.isAgency).reduce((a, s) => a + s.dueNow, 0))],
      ['Agency gross allocation (before expenses — not profit)', b.money(d.agencyAllocation)],
      ['Recorded project expenses', d.expenses > 0 ? `−${b.money(d.expenses)}` : b.money(0)],
      ['Agency balance after recorded expenses', b.money(d.agencyAfterExpenses)],
    ],
    columnStyles: { 0: { textColor: ESPRESSO }, 1: { halign: 'right', fontStyle: 'bold', cellWidth: 45 } },
    didParseCell: (c) => {
      if (c.row.index === 8) {
        c.cell.styles.fillColor = CREAM2;
        c.cell.styles.fontSize = 10.5;
        c.cell.styles.fontStyle = 'bold';
        if (c.column.index === 1 && d.agencyAfterExpenses < 0) c.cell.styles.textColor = RED;
      }
    },
  });

  const payouts = p.commissionPayouts;
  if (payouts.length) {
    b.sectionTitle('Commission payments made');
    b.table({
      head: [['Date', 'Paid to', 'Method', 'Note', 'Amount']],
      body: payouts.map((c) => [formatDate(c.date), p.split.find((s) => s.id === c.participantId)?.name ?? c.participantId, c.method || '—', c.note || '—', b.money(c.amountKobo)]),
      columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } },
    });
  }
  if (p.expenses.length) {
    b.sectionTitle('Recorded expenses');
    b.table({
      head: [['Date', 'Description', 'Amount']],
      body: p.expenses.map((e) => [formatDate(e.date), e.description, b.money(e.amountKobo)]),
      columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
    });
  }
  const m = maintenanceSummary(p.maintenance);
  if (m.active) {
    b.sectionTitle('Maintenance (tracked separately)');
    b.table({
      body: [
        ['Fee', `${b.money(p.maintenance.feeKobo)} ${FREQ_LABEL[p.maintenance.frequency]} from ${formatDate(p.maintenance.startDate)}`],
        ['Monthly recurring revenue', b.money(m.monthly)],
        ['Annualised estimate', b.money(m.annual)],
        ['Billed to date / received / outstanding', `${b.money(m.billedToDate)} / ${b.money(m.received)} / ${b.money(m.outstanding)}`],
      ],
      columnStyles: { 0: { textColor: MUTED, cellWidth: 70 }, 1: { fontStyle: 'bold' } },
    });
    b.paragraph('Maintenance revenue is NOT included in the developer project commissions above. Maintenance compensation is set by a separate agreement.', 8.5, MUTED);
  }

  b.sectionTitle('Reconciliation and rounding');
  const sum = d.shares.reduce((a, s) => a + s.amount, 0);
  b.paragraph(`${d.shares.map((s) => `${s.name} ${b.money(s.amount)}`).join(' + ')} = ${b.money(sum)}. Project total = ${b.money(t.total)}. ${d.reconciles ? 'RECONCILED — allocations equal exactly 100% of the project total.' : 'WARNING — allocations do not match the project total.'}`, 9, d.reconciles ? INK : RED);
  b.paragraph('Rounding rule: amounts are calculated in whole kobo. Developer shares are rounded down to the nearest kobo and the agency receives the exact remainder, so the shares always add up to the project total. The deposit is rounded to the nearest kobo and the delivery balance is the exact remainder.', 8.3, MUTED);
  if (p.internalNotes.trim()) {
    b.sectionTitle('Internal notes');
    b.paragraph(p.internalNotes, 9);
  }
  // Signature lines
  b.ensure(24);
  b.gap(8);
  const sw = (CONTENT_W - 16) / 3;
  ['Prepared by', 'Reviewed by', 'Date'].forEach((label, i) => {
    const sx = M + i * (sw + 8);
    b.doc.setDrawColor(...MUTED);
    b.doc.line(sx, b.y, sx + sw, b.y);
    b.font(8, 'normal', MUTED);
    b.doc.text(label, sx, b.y + 4);
  });
  b.y += 8;
  return b.finish();
}
