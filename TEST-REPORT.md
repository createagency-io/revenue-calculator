# Pre-deployment test report

**Date:** 31 Oct 2026. **Build tested:** the production build (`npm run build`), served locally and driven in Chromium.

## 1. Financial calculations: independent cross-check
`scripts/oracle.py` is a separate checker written in Python with exact `Decimal` maths. It shares no code with the app and works only from the written business rules. To run it:

```
FUZZ_N=10000 FUZZ_OUT=cases.json npx vitest run src/lib/fuzz.export.test.ts
python3 scripts/oracle.py cases.json
```

**Result: 10,000 random projects, 0 mismatches.** For every project the checker compared:
- the subtotal
- approved discounts, and unapproved ones (which must not be applied)
- the total, the deposit and the delivery balance
- verified vs pending payments, the outstanding balance and the payment status
- each person's allocation, earned-on-cash amount, amount paid, unpaid balance and amount due now
- the agency balance after expenses
- maintenance: monthly, annual, periods billed, outstanding

What the 10,000 projects covered:

| Case | Projects |
|---|---|
| Splits that produce fractions of a kobo | 7,600 |
| Non-default commission splits | 3,988 |
| Discounts | 6,021 |
| Fully paid | 1,949 |
| Overpaid (flagged) | 629 |
| Partly paid | 5,174 |
| Maintenance active | 4,985 |

In every project the three shares added up to exactly the project total. Each developer share was within 1 kobo below its exact value, and the agency took the exact remainder.

## 2. PDF export through the real app
`tests-e2e/pdf-export.cjs` clicks the actual Download buttons in the browser and saves every document for every project, 25 PDFs in total:
- 6 quotations
- 6 invoices
- 7 receipts (one of them issued during the test)
- 6 internal revenue reports

`scripts/verify_pdfs.py` then reads the text inside each PDF and checks it against independently computed figures.

**Result: 298 checks, 0 failed.** The checks confirmed:
- **Page format:** every document is A4, has the Carlito font embedded, shows the ₦ symbol as real text, and has correct "Page x of y" numbers.
- **Quotations:** the right subtotal, discount, total, 50% deposit, delivery balance and every line amount, plus the payment-instructions message and the validity date.
- **Invoices:** the full project value and "amount due on this invoice" are shown separately, and the outstanding balance is correct.
- **Receipts:** issued only for verified payments, with the correct amount, cumulative total paid and remaining balance.
- **Revenue reports:** each person's share in naira, shares that add up to the total and are marked "RECONCILED", the cash collected, and the agency balance after expenses. "CONFIDENTIAL — INTERNAL USE ONLY" appears on every page.
- **Privacy:** no client document contains developer names, commission figures, "25%" or "confidential".
- **Long documents:** these flow onto 2–3 pages with repeated table headers and no cut-off content.
- **Print:** the Print button loads the PDF into the browser's print frame.

**Fixed during testing:** on short invoices, the "How to pay" box sometimes dropped onto a second page by itself. I reduced the bottom margin and it now fits on page 1.

## 3. Full app flow
`tests-e2e/app-flow.cjs`: **38 of 38 checks passed.** This covers the 10 required scenarios plus:
- overpayment blocking
- receipt numbers never being duplicated
- commission payments larger than the allocation being blocked
- the search filters
- CSV export, and JSON export then import
- data persisting after a reload
- confirmation when the split changes
- no sideways scrolling on any phone-sized page
- no JavaScript errors

## 4. Unit tests
`npm test`: **25 of 25 passed.**

## 5. Logins, shared database and security (added 31 Oct 2026)

These tests ran against a **local copy of the Supabase stack**:
- **Postgres 16**, with `supabase/schema.sql` applied
- **Supabase Auth (GoTrue v2.170)**, which handles real email and password logins
- **PostgREST 12.2**, the same API layer Supabase uses

**Database rules** (`supabase/test/rls-test.sql`): **all passed.** They confirmed that:
- Visitors who aren't signed in get nothing.
- A signed-in account that isn't on the team list sees 0 records and can't write anything.
- Members can't write to tables directly. Every change goes through the version-checked functions.
- A stale save is rejected as a "conflict".
- Every change is recorded in the history table with who made it. The history can't be edited, and the restore command only works from the dashboard.
- Running the schema twice is safe.
- **200 receipt numbers requested by 4 people at the same moment came out with 0 duplicates.**

**Browser test against the stand-in** (`tests-e2e/supabase-flow.cjs`): **32 of 32 passed.**
- **Signing in:**
  - The sign-in screen appears before any data, even on a direct link to a page.
  - A wrong password is refused.
  - A valid account that isn't on the team list is refused.
- **Sharing data:**
  - Merlin's projects, payments and receipts appear for Tyson and for Jonathan on separate browsers.
  - Document numbers come from the database.
- **Editing at the same time:**
  - When two people edit the same project, it is caught. Nothing is overwritten, and the person gets a "keep mine or use theirs" choice.
  - Teammates' changes appear when you come back to the tab.
- **Going offline:** a change made offline is kept and saved automatically when the connection returns.
- **Direct API attempts:** anonymous reads and calls, non-member reads and writes, direct table writes and public sign-up were all blocked.
- **Passwords and sign-out:**
  - "Forgot password" sends an email link, refuses weak passwords, sets the new password, and the new password works.
  - You're signed out automatically after 30 idle minutes.
  - After signing out, the data pages are hidden.
- **Security header:** no Content-Security-Policy violations. PDF preview and print work under the strict policy.

**Not covered here:** live push updates (Supabase Realtime) need the real Supabase service. If they aren't available, the app still fetches teammates' changes whenever you return to the tab, and that part is tested.

**Regression after these changes:**
- app flow 38/38
- PDF export 25 PDFs / 298 checks
- independent calculation check 10,000 projects / 0 mismatches
- unit tests 27/27
