import { clientDisplayName, distribution, maintenanceSummary } from './calc';
import type { Project } from './types';

const money = (k: number) => (k / 100).toFixed(2);

function cell(v: string | number): string {
  const s = String(v ?? '');
  // Prevent spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function projectsToCSV(projects: Project[]): string {
  const devNames = projects[0]?.split.filter((s) => !s.isAgency).map((s) => s.name) ?? ['Developer 1', 'Developer 2'];
  const header = [
    'Quotation No', 'Invoice No', 'Client', 'Business', 'Email', 'Phone', 'Project', 'Package', 'Project status', 'Payment status',
    'Issued', 'Base price (NGN)', 'Add-ons (NGN)', 'Discount (NGN)', 'Total (NGN)', 'Deposit (NGN)', 'Received (NGN)', 'Pending (NGN)', 'Outstanding (NGN)',
    ...devNames.flatMap((n) => [`${n} allocation (NGN)`, `${n} paid (NGN)`]),
    'Agency allocation (NGN)', 'Expenses (NGN)', 'Agency after expenses (NGN)',
    'Maintenance fee (NGN)', 'Maintenance frequency', 'Maintenance received (NGN)', 'Maintenance outstanding (NGN)', 'Demo record',
  ];
  const rows = projects.map((p) => {
    const d = distribution(p);
    const m = maintenanceSummary(p.maintenance);
    const devs = d.shares.filter((s) => !s.isAgency);
    return [
      p.quoteNumber, p.invoiceNumber, p.client.fullName, clientDisplayName(p), p.client.email, p.client.phone, p.title, p.packageName, p.projectStatus, d.payments.status,
      p.issuedDate, money(d.totals.base), money(d.totals.addons), money(d.totals.discount), money(d.totals.total), money(d.totals.deposit),
      money(d.payments.verified), money(d.payments.pending), money(d.payments.outstanding),
      ...devs.flatMap((s) => [money(s.amount), money(s.paid)]),
      money(d.agencyAllocation), money(d.expenses), money(d.agencyAfterExpenses),
      money(p.maintenance.enabled ? p.maintenance.feeKobo : 0), p.maintenance.enabled ? p.maintenance.frequency : '', money(m.received), money(m.outstanding), p.isDemo ? 'yes' : 'no',
    ];
  });
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([type.includes('csv') ? '﻿' + text : text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
