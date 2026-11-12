const { chromium } = require('playwright');
const fs = require('fs');
const OUT = './test-output/app-flow';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://localhost:4173/';
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('create-agency-rms:local-mode', '1'); } catch {} }); // offline demo mode (no Supabase in this test)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED/.test(m.text()) && errors.push(m.text())); // ERR_FAILED = Google Fonts deliberately blocked in this test
  // block Google Fonts (no network in sandbox)
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(URL);
  await page.waitForSelector('text=Financial overview');
  ok('Overview loads with demo data', await page.isVisible('text=demo data'));
  await page.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true });

  const summaryTotal = async () => (await page.locator('text=Total project fee').locator('xpath=following-sibling::p').first().innerText()).trim();

  // ---- Scenario 1: Starter without add-ons
  await page.goto(URL + '#/calculator');
  await page.getByLabel('Client full name').fill('Test Starter Client');
  await page.getByLabel('Project title').fill('Starter test site');
  ok('1. Starter total ₦99,999.00', (await summaryTotal()) === '₦99,999.00', await summaryTotal());
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.waitForSelector('text=Editing CRQ-');
  const starterNo = (await page.locator('text=/Editing CRQ-/').innerText()).replace('Editing ', '');
  ok('1. Saved with next quotation number', /CRQ-\d{4}-0006/.test(starterNo), starterNo);

  // ---- Scenario 2: Business with multiple add-ons
  await page.goto(URL + '#/calculator');
  await page.getByLabel('Client full name').fill('Biz Client');
  await page.getByLabel('Project title').fill('Business site');
  await page.getByRole('button', { name: /^Business/ }).click();
  await page.getByText('Additional website page', { exact: true }).click();
  await page.getByText('Reservation / booking system', { exact: true }).click();
  await page.getByText('Content writing', { exact: true }).click();
  // set page qty to 3 via + twice (first row qty)
  const pageRow = page.locator('div.flex.flex-wrap.items-center.gap-3.py-3', { hasText: 'Additional website page' });
  await pageRow.getByLabel('Increase').click();
  await pageRow.getByLabel('Increase').click();
  ok('2. Business + 3 pages + booking + content ₦224,999.00', (await summaryTotal()) === '₦224,999.00', await summaryTotal());
  ok('2. WhatsApp shown as included in Business', await page.isVisible('text=Included in Business'));
  await page.screenshot({ path: `${OUT}/02-calculator-business.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.waitForSelector('text=Editing CRQ-');

  // ---- Scenario 3: Custom with manual price
  await page.goto(URL + '#/calculator');
  await page.getByLabel('Client full name').fill('Custom Client');
  await page.getByLabel('Project title').fill('Custom portal');
  await page.getByRole('button', { name: /^Premium \/ Custom/ }).click();
  await page.getByRole('button', { name: 'Save project' }).click();
  ok('3. Custom blocked without agreed price', await page.isVisible('text=needs the agreed price'));
  await page.getByLabel('Agreed price (after consultation)').fill('1,250,000.50');
  ok('3. Custom total uses manual price', (await summaryTotal()) === '₦1,250,000.50', await summaryTotal());
  await page.getByLabel('Agreed price (after consultation)').fill('-500');
  ok('3. Negative price rejected', await page.isVisible('text=no negatives'));
  await page.getByLabel('Agreed price (after consultation)').fill('1,250,000.50');

  // ---- Scenario 4: Discount
  await page.getByLabel('Discount type').selectOption('percent');
  await page.getByLabel('Discount percentage').fill('10');
  ok('4. Unapproved discount not applied', (await summaryTotal()) === '₦1,250,000.50' && (await page.isVisible('text=not approved, so it is not applied')));
  await page.getByText('This discount is approved').click();
  await page.getByLabel('Approved by').fill('Merlin');
  await page.getByLabel('Reason (shown to client)').fill('Launch promo');
  ok('4. Approved 10% discount applied', (await summaryTotal()) === '₦1,125,000.45', await summaryTotal());
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.waitForSelector('text=Editing CRQ-');
  const customUrl = page.url();
  const customId = customUrl.split('/').pop();

  // quotation download
  const [qd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Quotation PDF' }).click()]);
  await qd.saveAs(`${OUT}/custom-quotation.pdf`);
  ok('Quotation PDF downloads', fs.statSync(`${OUT}/custom-quotation.pdf`).size > 5000, qd.suggestedFilename());

  // ---- Invoices: deposit
  await page.goto(URL + `#/invoices?p=${customId}`);
  await page.waitForSelector('text=Create an invoice');
  const [invd] = await Promise.all([page.waitForSelector('[role=dialog]'), page.getByRole('button', { name: /Create invoice for ₦562,500.23/ }).click()]);
  ok('Deposit invoice created (50% rounded to kobo ₦562,500.23)', !!invd);
  await page.screenshot({ path: `${OUT}/03-invoice-preview.png` });
  const [invDl] = await Promise.all([page.waitForEvent('download'), page.locator('[role=dialog]').getByRole('button', { name: 'Download PDF' }).click()]);
  await invDl.saveAs(`${OUT}/custom-invoice.pdf`);
  await page.locator('[role=dialog]').getByLabel('Close').click();

  // ---- Scenario 5: partial payment (pending then verify)
  await page.goto(URL + `#/receipts?p=${customId}`);
  await page.waitForSelector('text=Record a payment');
  await page.getByLabel('Amount').fill('5,000,000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  ok('Overpayment blocked', await page.isVisible('text=more than the remaining balance'));
  await page.getByLabel('Amount').fill('300,000');
  await page.getByLabel('Transaction reference').fill('TRF-TEST-1');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForSelector('text=Pending — not yet confirmed');
  ok('5. Pending payment shows no receipt button', !(await page.locator('text=Pending — not yet confirmed').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').getByRole('button', { name: 'PDF' }).count()));
  await page.getByRole('button', { name: 'Mark received & verified' }).click();
  await page.getByRole('button', { name: "Yes, it's in our account" }).click();
  await page.waitForSelector('text=Verified');
  ok('5. Status Partially paid after ₦300,000', await page.isVisible('text=Partially paid'));

  // ---- Scenario 7: receipt generation
  const [rd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF', exact: true }).first().click()]);
  await rd.saveAs(`${OUT}/custom-receipt.pdf`);
  const rName1 = rd.suggestedFilename();
  const [rd2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF', exact: true }).first().click()]);
  const rName2 = rd2.suggestedFilename();
  ok('7. Receipt issued with number, re-download reuses same number', rName1.startsWith('CRR-') && rName1.split('-Receipt')[0] === rName2.split('-Receipt')[0], `${rName1} / ${rName2}`);

  // ---- Scenario 6: fully paid (pay remaining)
  await page.getByLabel('Amount').fill('825,000.45');
  await page.getByText('I have confirmed this money is in our account').click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForTimeout(300);
  ok('6. Fully paid after remaining balance', await page.locator('text=Fully paid').first().isVisible());
  await page.screenshot({ path: `${OUT}/04-receipts.png`, fullPage: true });

  // ---- Scenario 8: internal revenue breakdown
  await page.goto(URL + `#/distribution?p=${customId}`);
  await page.waitForSelector('text=Who gets what');
  const [revd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Full Revenue Breakdown PDF' }).click()]);
  await revd.saveAs(`${OUT}/custom-revenue.pdf`);
  ok('8. Revenue breakdown PDF downloads', fs.statSync(`${OUT}/custom-revenue.pdf`).size > 5000, revd.suggestedFilename());
  ok('8. Print button present', await page.isVisible('text=Print Full Revenue Breakdown'));
  await page.getByLabel('Amount').fill('999,999,999');
  await page.getByRole('button', { name: 'Record commission payment' }).click();
  ok('Commission over allocation blocked', await page.isVisible('text=can’t pay out more than the allocation'));
  await page.getByRole('button', { name: 'Fill amount due now' }).click();
  await page.getByRole('button', { name: 'Record commission payment' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/05-distribution.png`, fullPage: true });

  // ---- History filters + CSV + delete
  await page.goto(URL + '#/history');
  await page.getByLabel('Search by client').fill('custom client');
  ok('History search by client', (await page.locator('tbody tr').count()) === 1);
  await page.getByLabel('Search by client').fill('');
  await page.getByLabel('Filter by package').selectOption('starter');
  const starterRows = await page.locator('tbody tr').count();
  ok('History filter by package', starterRows === 2, `${starterRows} rows`);
  await page.getByLabel('Filter by package').selectOption('');
  await page.getByLabel('Filter by payment status').selectOption('Fully paid');
  ok('History filter by payment status', (await page.locator('tbody tr').count()) >= 2);
  await page.getByLabel('Filter by payment status').selectOption('');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  await csv.saveAs(`${OUT}/export.csv`);
  ok('CSV export', fs.readFileSync(`${OUT}/export.csv`, 'utf8').split('\n').length >= 8);
  const [js] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON backup' }).click()]);
  await js.saveAs(`${OUT}/backup.json`);
  const before = await page.locator('tbody tr').count();
  await page.locator('tbody tr', { hasText: 'Starter test site' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  ok('Delete with confirmation', (await page.locator('tbody tr').count()) === before - 1);
  // Import the backup back
  await page.locator('input[type=file]').setInputFiles(`${OUT}/backup.json`);
  await page.getByRole('button', { name: 'Replace my data' }).click();
  await page.waitForTimeout(200);
  ok('JSON import restores records', (await page.locator('tbody tr').count()) === before);
  await page.screenshot({ path: `${OUT}/06-history.png`, fullPage: true });

  // ---- Persistence after reload
  await page.reload();
  await page.waitForSelector('text=Project history');
  ok('Data persists after reload', (await page.locator('tbody tr').count()) === before);

  // ---- Settings: split change requires confirmation
  await page.goto(URL + '#/settings');
  const shares = page.getByLabel('Share');
  await shares.nth(0).fill('30');
  ok('Split ≠ 100% blocks saving', await page.isVisible('text=must be exactly 100%'));
  await shares.nth(1).fill('20');
  await page.getByRole('button', { name: 'Save settings' }).click();
  ok('Split change asks for confirmation', await page.isVisible('text=Change the commission split?'));
  await page.getByRole('button', { name: 'Yes, save new split' }).click();
  await page.waitForTimeout(200);
  ok('Split change logged', await page.isVisible('text=Change history (1)'));
  await page.screenshot({ path: `${OUT}/07-settings.png`, fullPage: true });

  // ---- Mobile layout
  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { try { localStorage.setItem('create-agency-rms:local-mode', '1'); } catch {} }); // offline demo mode (no Supabase in this test)
  const mp = await m.newPage();
  await mp.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  for (const v of ['overview', 'calculator', 'invoices', 'receipts', 'distribution', 'history', 'settings']) {
    await mp.goto(URL + '#/' + v);
    await mp.waitForTimeout(250);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`Mobile ${v}: no horizontal page scroll`, overflow <= 0, `overflow ${overflow}px`);
    if (['overview', 'calculator', 'distribution'].includes(v)) await mp.screenshot({ path: `${OUT}/m-${v}.png`, fullPage: true });
  }
  ok('No JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('CRASH', e.message);
  process.exit(1);
});
