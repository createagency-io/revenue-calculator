import type { Settings } from './types';

const N = (naira: number) => naira * 100; // naira -> kobo (whole naira literals only)

export function defaultSettings(): Settings {
  return {
    version: 1,
    company: {
      name: 'C.R.E.A.T.E. Agency',
      website: 'createagency.io',
      email: 'hello@createagency.io',
      phone: '',
      address: 'Nigeria',
      logoDataUrl: '',
    },
    packages: [
      {
        id: 'starter',
        name: 'Starter',
        priceKobo: N(99_999),
        inclusions: [
          'Up to 5 pages',
          'Mobile-friendly responsive design',
          'Contact form and WhatsApp chat button',
          'Basic on-page SEO',
          'Free SSL setup and launch support',
          '1 revision round',
        ],
        includedAddonIds: [],
      },
      {
        id: 'business',
        name: 'Business',
        priceKobo: N(129_999),
        inclusions: [
          'Up to 8 pages',
          'Everything in Starter',
          'WhatsApp ordering integration',
          'Google Maps and social media links',
          '2 revision rounds',
        ],
        includedAddonIds: ['whatsapp'],
      },
      {
        id: 'professional',
        name: 'Professional',
        priceKobo: N(159_999),
        inclusions: [
          'Up to 10 pages',
          'Everything in Business',
          'Custom UI/UX design and branding touches',
          'Advanced SEO setup',
          '3 revision rounds',
        ],
        includedAddonIds: ['whatsapp', 'uiux', 'seo'],
      },
      {
        id: 'ecommerce',
        name: 'E-Commerce',
        priceKobo: N(189_999),
        inclusions: [
          'Online store with product catalogue',
          'Secure Naira payment gateway integration',
          'WhatsApp ordering integration',
          'Advanced SEO setup',
          '3 revision rounds',
        ],
        includedAddonIds: ['payment', 'whatsapp', 'seo'],
      },
      {
        id: 'custom',
        name: 'Premium / Custom',
        priceKobo: null,
        inclusions: ['Scope agreed after consultation', 'Bespoke platforms, portals and creative campaigns'],
        includedAddonIds: [],
      },
    ],
    addons: [
      { id: 'page', name: 'Additional website page', unitPriceKobo: N(15_000), unit: 'per page', description: 'One extra page designed and built to match the site.', allowQuantity: true },
      { id: 'uiux', name: 'Extra custom UI/UX design', unitPriceKobo: N(30_000), unit: 'flat', description: 'Additional bespoke interface design work.', allowQuantity: true },
      { id: 'whatsapp', name: 'WhatsApp ordering integration', unitPriceKobo: N(25_000), unit: 'flat', description: 'Customers send pre-filled orders straight to your WhatsApp.', allowQuantity: false },
      { id: 'booking', name: 'Reservation / booking system', unitPriceKobo: N(40_000), unit: 'flat', description: 'Online booking or reservation request flow.', allowQuantity: false },
      { id: 'payment', name: 'Payment gateway integration', unitPriceKobo: N(50_000), unit: 'flat', description: 'Paystack / Flutterwave checkout integration.', allowQuantity: false },
      { id: 'seo', name: 'Advanced SEO setup', unitPriceKobo: N(30_000), unit: 'flat', description: 'Keyword research, schema markup and Google Business setup.', allowQuantity: false },
      { id: 'content', name: 'Content writing', unitPriceKobo: N(10_000), unit: 'per page', description: 'Professional copy written for each page.', allowQuantity: true },
      { id: 'revision', name: 'Additional revision round', unitPriceKobo: N(15_000), unit: 'per round', description: 'One more round of changes after the included revisions.', allowQuantity: true },
    ],
    split: [
      { id: 'jonathan', name: 'Jonathan', role: 'Developer', bps: 2500, isAgency: false },
      { id: 'tyson', name: 'Tyson', role: 'Developer', bps: 2500, isAgency: false },
      { id: 'agency', name: 'C.R.E.A.T.E. Agency', role: 'Agency', bps: 5000, isAgency: true },
    ],
    depositBps: 5000,
    numbering: {
      quotePrefix: 'CRQ',
      invoicePrefix: 'CRI',
      receiptPrefix: 'CRR',
      nextQuote: 1,
      nextInvoice: 1,
      nextReceipt: 1,
      includeYear: true,
    },
    paymentTermsDays: 7,
    quoteValidityDays: 14,
    defaultAssumptions: [
      'The client will provide logo, brand colours, photos and business details before design starts.',
      'Domain name and hosting costs are not included unless listed above.',
      'Work begins once the deposit has been received.',
      'Extra pages or features requested after approval will be quoted separately.',
    ].join('\n'),
    defaultTerms: [
      'A 50% deposit is required before work begins. The remaining 50% is due on delivery, before the site is handed over or launched.',
      'This quotation is valid until the date shown above.',
      'Revision rounds are limited to those included in the package. Extra rounds are charged as listed.',
      'The client owns the final website content and design once full payment has been received.',
      'Monthly maintenance, where selected, is billed separately and can be cancelled with 30 days notice.',
    ].join('\n'),
    paymentInstructionsNote: 'Payment instructions will be provided directly by C.R.E.A.T.E. Agency.',
    pdf: {
      accent: '#C2693A',
      footerNote: 'Thank you for choosing C.R.E.A.T.E. Agency — Your story. Your stage. Your brand.',
      currencyLabel: 'symbol',
    },
    splitChangeLog: [],
  };
}
