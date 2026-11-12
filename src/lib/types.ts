import type { Bps, Kobo } from './money';

export interface PackageDef {
  id: string;
  name: string;
  /** null = Premium / Custom: price agreed after consultation, never shown as a fixed price. */
  priceKobo: Kobo | null;
  inclusions: string[];
  /** Add-on ids already included in this package (they can't be charged again). */
  includedAddonIds: string[];
}

export interface AddonDef {
  id: string;
  name: string;
  unitPriceKobo: Kobo;
  unit: string; // "per page", "flat", "per round"
  description: string;
  allowQuantity: boolean;
}

export interface Participant {
  id: string;
  name: string;
  role: string;
  bps: Bps;
  isAgency: boolean;
}

export interface Settings {
  version: 1;
  company: {
    name: string;
    website: string;
    email: string;
    phone: string;
    address: string;
    logoDataUrl: string;
  };
  packages: PackageDef[];
  addons: AddonDef[];
  split: Participant[];
  depositBps: Bps;
  numbering: {
    quotePrefix: string;
    invoicePrefix: string;
    receiptPrefix: string;
    nextQuote: number;
    nextInvoice: number;
    nextReceipt: number;
    includeYear: boolean;
  };
  paymentTermsDays: number;
  quoteValidityDays: number;
  defaultTerms: string;
  defaultAssumptions: string;
  paymentInstructionsNote: string;
  pdf: {
    accent: string; // hex
    footerNote: string;
    currencyLabel: 'symbol' | 'code';
  };
  /** Settings history: every explicit change to commission percentages. */
  splitChangeLog: { at: string; from: string; to: string }[];
}

export interface LineItem {
  id: string;
  addonId: string | null; // null = custom service
  name: string;
  description: string;
  unitPriceKobo: Kobo;
  qty: number;
}

export interface Discount {
  type: 'none' | 'amount' | 'percent';
  amountKobo: Kobo;
  bps: Bps;
  reason: string;
  approved: boolean;
  approvedBy: string;
}

export type PaymentMethod = 'Bank transfer' | 'Cash' | 'POS / Card' | 'Paystack' | 'Flutterwave' | 'Cheque' | 'Other';

export interface ClientPayment {
  id: string;
  amountKobo: Kobo;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  status: 'pending' | 'verified';
  verifiedAt: string | null;
  /** Assigned once, the first time a receipt is generated. Re-downloads reuse it. */
  receiptNumber: string | null;
  receiptIssuedAt: string | null;
  isOverpayment: boolean;
  invoiceNumber: string;
}

export interface CommissionPayout {
  id: string;
  participantId: string;
  amountKobo: Kobo;
  date: string;
  method: string;
  note: string;
}

export interface Expense {
  id: string;
  description: string;
  amountKobo: Kobo;
  date: string;
}

export type MaintenanceFrequency = 'monthly' | 'quarterly' | 'annually';

export interface MaintenancePayment {
  id: string;
  amountKobo: Kobo;
  date: string;
  periodLabel: string;
  method: string;
  reference: string;
}

export interface Maintenance {
  enabled: boolean;
  feeKobo: Kobo; // per billing period
  frequency: MaintenanceFrequency;
  startDate: string;
  description: string;
  showOnQuote: boolean;
  payments: MaintenancePayment[];
}

export type ProjectStatus = 'Quotation' | 'Approved' | 'In progress' | 'Delivered' | 'Completed' | 'On hold' | 'Cancelled';

export interface InvoiceRecord {
  number: string;
  issuedDate: string;
  dueDate: string;
  label: string; // "Deposit (50%)", "Delivery balance", "Custom"
  amountKobo: Kobo; // the installment requested on this invoice
}

export interface Project {
  id: string;
  isDemo: boolean;
  quoteNumber: string;
  invoiceNumber: string;
  client: { fullName: string; business: string; email: string; phone: string };
  title: string;
  description: string;
  packageId: string;
  packageName: string;
  basePriceKobo: Kobo;
  lineItems: LineItem[];
  discount: Discount;
  startDate: string;
  expectedCompletion: string;
  issuedDate: string;
  dueDate: string;
  quoteValidUntil: string;
  projectStatus: ProjectStatus;
  payments: ClientPayment[];
  invoices: InvoiceRecord[];
  /** Copied from Settings when the project is created so later settings changes never rewrite history. */
  split: Participant[];
  depositBps: Bps;
  commissionPayouts: CommissionPayout[];
  expenses: Expense[];
  maintenance: Maintenance;
  scope: string;
  terms: string;
  internalNotes: string;
  clientNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  settings: Settings;
  projects: Project[];
}
