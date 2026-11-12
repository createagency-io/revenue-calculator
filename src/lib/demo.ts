import { blankProject, lineFromAddon } from './factory';
import type { AppData, ClientPayment, Project, Settings } from './types';
import { defaultSettings } from './defaults';

const N = (naira: number) => naira * 100;

function pay(id: string, amountKobo: number, date: string, invoiceNumber: string, extra: Partial<ClientPayment> = {}): ClientPayment {
  return {
    id,
    amountKobo,
    date,
    method: 'Bank transfer',
    reference: `TRF${date.replace(/-/g, '')}${id.slice(-3).toUpperCase()}`,
    note: '',
    status: 'verified',
    verifiedAt: `${date}T12:00:00.000Z`,
    receiptNumber: null,
    receiptIssuedAt: null,
    isOverpayment: false,
    invoiceNumber,
    ...extra,
  };
}

/** Fictional demo clients for testing. Every record is flagged isDemo so it can be cleared in one click. */
export function demoData(): AppData {
  const s: Settings = defaultSettings();
  const mk = (over: (p: Project) => void): Project => {
    const p = blankProject(s);
    p.isDemo = true;
    over(p);
    return p;
  };
  const pkg = (p: Project, id: string, price?: number) => {
    const d = s.packages.find((x) => x.id === id)!;
    p.packageId = d.id;
    p.packageName = d.name;
    p.basePriceKobo = price ?? d.priceKobo ?? 0;
  };

  const projects: Project[] = [
    // 1. Starter package, no add-ons, fully paid
    mk((p) => {
      p.id = 'demo_1';
      p.quoteNumber = 'CRQ-2026-0001';
      p.invoiceNumber = 'CRI-2026-0001';
      p.client = { fullName: 'Kemi Adeyemi', business: 'Kemi Braids & Beauty (Demo)', email: 'kemi@example.com', phone: '0801 234 5678' };
      p.title = 'Salon website';
      p.description = 'A simple five-page website for a hair and beauty salon in Ikeja, with a WhatsApp chat button.';
      pkg(p, 'starter');
      p.issuedDate = '2026-08-04';
      p.quoteValidUntil = '2026-08-18';
      p.dueDate = '2026-08-11';
      p.startDate = '2026-08-10';
      p.expectedCompletion = '2026-08-28';
      p.projectStatus = 'Completed';
      p.invoices = [
        { number: 'CRI-2026-0001', issuedDate: '2026-08-05', dueDate: '2026-08-12', label: 'Deposit (50%)', amountKobo: 5_000_000 - 50 },
      ];
      p.payments = [
        pay('demo_1_a', 4_999_950, '2026-08-08', 'CRI-2026-0001', { receiptNumber: 'CRR-2026-0001', receiptIssuedAt: '2026-08-08T13:00:00.000Z' }),
        pay('demo_1_b', 4_999_950, '2026-08-29', 'CRI-2026-0001', { method: 'POS / Card', receiptNumber: 'CRR-2026-0002', receiptIssuedAt: '2026-08-29T13:00:00.000Z' }),
      ];
      p.commissionPayouts = [
        { id: 'demo_1_c1', participantId: 'jonathan', amountKobo: 2_499_975, date: '2026-08-30', method: 'Bank transfer', note: 'Full commission' },
        { id: 'demo_1_c2', participantId: 'tyson', amountKobo: 2_499_975, date: '2026-08-30', method: 'Bank transfer', note: 'Full commission' },
      ];
      p.expenses = [{ id: 'demo_1_e1', description: 'Stock photos', amountKobo: N(4_500), date: '2026-08-12' }];
    }),

    // 2. Business package with several add-ons + maintenance, deposit paid
    mk((p) => {
      p.id = 'demo_2';
      p.quoteNumber = 'CRQ-2026-0002';
      p.invoiceNumber = 'CRI-2026-0002';
      p.client = { fullName: 'Ngozi Eze', business: 'Mama Ngozi Kitchen (Demo)', email: 'orders@example.com', phone: '0809 876 5432' };
      p.title = 'Restaurant website with bookings';
      p.description = 'Multi-page restaurant site with menu, table reservations and WhatsApp food ordering.';
      pkg(p, 'business');
      p.lineItems = [lineFromAddon(s, 'page', 3), lineFromAddon(s, 'content', 11), lineFromAddon(s, 'booking', 1)];
      p.lineItems.forEach((l, i) => (l.id = `demo_2_li${i}`));
      p.issuedDate = '2026-09-02';
      p.quoteValidUntil = '2026-09-16';
      p.dueDate = '2026-09-09';
      p.startDate = '2026-09-07';
      p.expectedCompletion = '2026-10-05';
      p.projectStatus = 'In progress';
      p.invoices = [{ number: 'CRI-2026-0002', issuedDate: '2026-09-03', dueDate: '2026-09-10', label: 'Deposit (50%)', amountKobo: 16_249_950 }];
      p.payments = [pay('demo_2_a', 16_249_950, '2026-09-06', 'CRI-2026-0002', { receiptNumber: 'CRR-2026-0003', receiptIssuedAt: '2026-09-06T13:00:00.000Z' })];
      p.commissionPayouts = [
        { id: 'demo_2_c1', participantId: 'jonathan', amountKobo: N(30_000), date: '2026-09-20', method: 'Bank transfer', note: 'Advance on deposit' },
      ];
      p.maintenance = { enabled: true, feeKobo: N(15_000), frequency: 'monthly', startDate: '2026-10-05', description: 'Monthly website care: menu updates, backups and security checks.', showOnQuote: true, payments: [{ id: 'demo_2_m1', amountKobo: N(15_000), date: '2026-10-05', periodLabel: 'October 2026', method: 'Bank transfer', reference: 'MNT-OCT' }] };
    }),

    // 3. Premium / Custom with manually entered price, partial payment + one pending
    mk((p) => {
      p.id = 'demo_3';
      p.quoteNumber = 'CRQ-2026-0003';
      p.invoiceNumber = 'CRI-2026-0003';
      p.client = { fullName: 'Tunde Bakare', business: 'Harbour Logistics Ltd (Demo)', email: 'tunde@example.com', phone: '0703 111 2222' };
      p.title = 'Customer tracking portal';
      p.description = 'Custom portal where customers track shipments and download waybills. Scope agreed after two consultation calls.';
      pkg(p, 'custom', N(850_000));
      p.issuedDate = '2026-09-15';
      p.quoteValidUntil = '2026-09-29';
      p.dueDate = '2026-09-22';
      p.startDate = '2026-09-28';
      p.expectedCompletion = '2026-12-15';
      p.projectStatus = 'In progress';
      p.invoices = [{ number: 'CRI-2026-0003', issuedDate: '2026-09-16', dueDate: '2026-09-23', label: 'Deposit (50%)', amountKobo: N(425_000) }];
      p.payments = [
        pay('demo_3_a', N(200_000), '2026-09-25', 'CRI-2026-0003', { receiptNumber: 'CRR-2026-0004', receiptIssuedAt: '2026-09-25T13:00:00.000Z', note: 'First part of deposit' }),
        pay('demo_3_b', N(100_000), '2026-10-20', 'CRI-2026-0003', { status: 'pending', verifiedAt: null, note: 'Client says transfer sent — not yet confirmed in bank' }),
      ];
      p.expenses = [{ id: 'demo_3_e1', description: 'Cloud server (3 months)', amountKobo: N(36_000), date: '2026-09-30' }];
    }),

    // 4. Discounted Professional project, quotation stage
    mk((p) => {
      p.id = 'demo_4';
      p.quoteNumber = 'CRQ-2026-0004';
      p.invoiceNumber = 'CRI-2026-0004';
      p.client = { fullName: 'Amaka Obi', business: 'Obi & Partners Law (Demo)', email: 'amaka@example.com', phone: '0812 333 4444' };
      p.title = 'Law firm website';
      p.description = 'Professional website for a law firm with practice areas, team profiles and a consultation request form.';
      pkg(p, 'professional');
      p.lineItems = [lineFromAddon(s, 'page', 2), lineFromAddon(s, 'revision', 1)];
      p.lineItems.forEach((l, i) => (l.id = `demo_4_li${i}`));
      p.discount = { type: 'percent', amountKobo: 0, bps: 1000, reason: 'Referral discount', approved: true, approvedBy: 'Merlin' };
      p.issuedDate = '2026-10-21';
      p.quoteValidUntil = '2026-11-04';
      p.dueDate = '2026-10-28';
      p.startDate = '2026-11-02';
      p.expectedCompletion = '2026-11-30';
      p.projectStatus = 'Quotation';
    }),

    // 5. E-commerce with a 5% discount that creates fractional kobo, fully paid with commission due
    mk((p) => {
      p.id = 'demo_5';
      p.quoteNumber = 'CRQ-2026-0005';
      p.invoiceNumber = 'CRI-2026-0005';
      p.client = { fullName: 'Ibrahim Musa', business: 'Arewa Threads (Demo)', email: 'shop@example.com', phone: '0705 555 6666' };
      p.title = 'Online fashion store';
      p.description = 'E-commerce store selling ready-to-wear fabrics with Naira card payments and WhatsApp ordering.';
      pkg(p, 'ecommerce');
      p.lineItems = [lineFromAddon(s, 'page', 1)];
      p.lineItems[0].id = 'demo_5_li0';
      p.discount = { type: 'percent', amountKobo: 0, bps: 500, reason: 'Launch promotion', approved: true, approvedBy: 'Merlin' };
      p.issuedDate = '2026-09-10';
      p.quoteValidUntil = '2026-09-24';
      p.dueDate = '2026-09-17';
      p.startDate = '2026-09-14';
      p.expectedCompletion = '2026-10-10';
      p.projectStatus = 'Delivered';
      // total 19,474,905 kobo -> deposit 9,737,453 / balance 9,737,452
      p.invoices = [
        { number: 'CRI-2026-0005', issuedDate: '2026-09-11', dueDate: '2026-09-18', label: 'Deposit (50%)', amountKobo: 9_737_453 },
        { number: 'CRI-2026-0006', issuedDate: '2026-10-10', dueDate: '2026-10-17', label: 'Delivery balance', amountKobo: 9_737_452 },
      ];
      p.payments = [
        pay('demo_5_a', 9_737_453, '2026-09-13', 'CRI-2026-0005', { receiptNumber: 'CRR-2026-0005', receiptIssuedAt: '2026-09-13T13:00:00.000Z' }),
        pay('demo_5_b', 9_737_452, '2026-10-12', 'CRI-2026-0006', { method: 'Paystack' }),
      ];
      p.expenses = [{ id: 'demo_5_e1', description: 'Premium theme licence', amountKobo: N(12_000), date: '2026-09-15' }];
      p.maintenance = { enabled: true, feeKobo: N(60_000), frequency: 'quarterly', startDate: '2026-10-10', description: 'Quarterly store care: product uploads, plugin updates and backups.', showOnQuote: true, payments: [] };
    }),
  ];

  s.numbering.nextQuote = 6;
  s.numbering.nextInvoice = 7;
  s.numbering.nextReceipt = 6;
  return { settings: s, projects };
}
