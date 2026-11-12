# C.R.E.A.T.E. Revenue Calculator & Project Financial Management System

A private web app for C.R.E.A.T.E. Agency. Use it to:

- price client projects
- send quotations, invoices and receipts as PDFs
- track client payments
- split project revenue between Jonathan (25%), Tyson (25%) and the agency (50%)
- produce a confidential internal revenue report for each project

Built with React, TypeScript, Tailwind CSS and jsPDF + AutoTable. It runs entirely in the browser, with no backend and no paid PDF service.

> **Logins and shared database**
> - Each person (Merlin, Tyson, Jonathan) signs in with their own email and password, through Supabase Auth.
> - All records are saved in one shared **Supabase (Postgres)** database, so they show up on every device.
> - Only emails on the team list can read or change anything. The database enforces this, not just the app.
> - Public sign-up is disabled. Every save is version-checked, so two people can't silently overwrite each other, and every change is kept in a history table.
> - **To set it up, follow [SETUP-GUIDE.md](SETUP-GUIDE.md).**
> - Without Supabase keys, the app offers an **offline demo mode**: no password, and data stays in that browser only. It's for trying the app out, not for real data.

---

## 1. Run it on your computer

You need **Node.js 20 or newer**. Download the LTS version from https://nodejs.org.

1. Unzip the project folder.
2. Open a terminal in that folder. On Windows, open the folder in File Explorer, click the address bar, type `cmd` and press Enter.
3. Install the packages. You only need to do this once:
   ```
   npm install
   ```
4. Start the app:
   ```
   npm run dev
   ```
5. Open the link it prints (usually http://localhost:5173).

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the money and PDF tests (24 tests) |
| `npm run build` | Builds the production version into the `dist` folder |
| `npm run preview` | Serves the built `dist` folder locally |

Without keys in `public/config.js`, the app shows the **Connect your database** screen. You can paste your Supabase keys there, or choose the offline demo, which has five fictional clients. To test against Supabase locally, put your keys in `public/config.js`.

---

## 2. Deploy to Netlify

### Option A: Drag and drop (easiest)
1. Run `npm run build`.
2. Open `dist/config.js` in Notepad and paste your Supabase URL and anon key. See SETUP-GUIDE Part 6.
3. Go to https://app.netlify.com/drop.
4. Drag the **`dist`** folder onto the page.
4. Netlify gives you a link. Rename the site under **Site configuration → Change site name**, for example `create-finance`.

### Option B: From GitHub (updates automatically)
1. Push this folder to a repo in the **createagency-io** GitHub organization. Make it **private**, since this is internal.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo.
3. Netlify reads `netlify.toml` automatically. The build command is `npm run build` and the publish folder is `dist`. Click **Deploy**.
4. Remember to fill in `public/config.js` (and commit it) so the deployed site knows your Supabase project. The anon key is safe to commit; the service_role key never is.

`public/_headers` tells search engines not to index the site and adds strict security headers. These include a Content-Security-Policy that only allows connections to your own site and `*.supabase.co`.

---

## 3. How it works

### Sections
- **Overview**: dashboard cards covering contracted revenue, cash received, outstanding balances, each developer's allocation and payouts, the agency allocation, expenses and maintenance. Includes charts and filters by project and date range.
- **New Project / Calculator**: pick a package and add-ons, apply an approved discount, set dates and status, and add optional maintenance. Totals and the split update as you type.
- **Quotations**: preview, download, print or duplicate any quotation.
- **Invoices**: create a Deposit, Delivery-balance, Full-outstanding or Custom invoice for a project.
- **Receipts & Payments**: record payments, verify them, and issue receipts.
- **Revenue Distribution** (internal): who gets what, commission payouts, project expenses, maintenance payments, and the **Download / Print Full Revenue Breakdown** buttons.
- **Project History**: search by client; filter by package, payment status or stage; edit, duplicate, regenerate documents or delete (with confirmation); export CSV; export or import JSON backups.
- **Settings**: company details and logo, package prices and inclusions, add-on prices, developer names and percentages, deposit %, document numbering, payment terms, PDF branding, and data tools.

### Money rules
- All amounts are stored as **whole kobo** (₦1 = 100 kobo) and percentages as whole basis points (25% = 2500). No floating-point maths is used for totals.
- **Total = package price + add-ons − approved discount.** A discount only counts after you tick "approved" and enter who approved it.
- **Deposit:** 50% of the total, rounded to the nearest kobo (halves round up). The **delivery balance** is the exact remainder.
- **Revenue split:** each developer's share is rounded **down** to the kobo, and the agency gets the exact remainder. The three amounts therefore always add up to exactly the project total, and the app checks and shows this.
- The agency's 50% is a **gross allocation before expenses**, not profit.
- **Maintenance** is tracked separately and is **not** part of the developers' 25% project commission.

### Safety rules built in
- Prices, quantities and amounts can't be negative or invalid.
- Add-ons already included in a package can't be charged again.
- A payment can't be larger than what's still owed. The only exception is when you tick **Record as overpayment** and write a note.
- Payments start as **pending**. Only **verified** payments count as received, and only verified payments can get a receipt.
- Each payment gets **one** receipt number, issued once. Re-downloading reuses the same number. Verified payments can't be deleted.
- Document numbers are unique and used numbers are always skipped.
- Each project keeps the revenue split it was created with. Changing percentages in Settings asks for confirmation and is recorded in a change history.
- Client quotations, invoices and receipts **never** contain commission or internal revenue figures. Those only appear in the confidential internal report, which carries a red "CONFIDENTIAL — INTERNAL USE ONLY" band on every page.

### PDFs
- A4, multi-page, with branded headers and footers, page numbers, document numbers and dates.
- They use the embedded **Carlito** font (SIL Open Font License), which has a real **₦** symbol. If you prefer, switch to "NGN" text in Settings → PDF branding.
- **Preview** shows the PDF before you download or print. On phones the preview may open in a new tab instead.

---

## 4. Project structure

```
src/
  lib/
    money.ts       kobo maths, rounding rules, parsing and formatting
    calc.ts        totals, payments, split, maintenance, numbering, validation
    types.ts       data model
    defaults.ts    default packages, add-ons, split and terms
    demo.ts        fictional demo projects
    backend.ts     Supabase backend (shared database) + offline demo backend
    config.ts      reads Supabase URL/key from config.js (refuses the secret key)
    storage.ts     browser storage for the offline demo mode, JSON backup import/export
    csv.ts         CSV export
    store.tsx      app state: saves every change, retries when offline, detects edit conflicts
    calc.test.ts   tests for all required scenarios
  pdf/
    base.ts        A4 layout, header/footer, tables, ₦ font
    documents.ts   Quotation, Invoice, Receipt, Internal Revenue Distribution
    output.ts      download / print helpers
    pdf.test.ts    PDF generation tests
  components/      UI building blocks, PDF preview, document buttons, AuthGate (sign-in, reset, auto sign-out)
supabase/
  schema.sql       tables, security rules, numbering, history — paste into the Supabase SQL Editor
  test/            local security tests for the schema
tests-e2e/         browser tests (app flow, PDF export, Supabase login/sync/security)
scripts/           independent calculation checker and PDF verifier
  views/           one file per section
```
