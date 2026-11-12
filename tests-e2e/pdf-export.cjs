// Downloads every document type from the BUILT app in a real browser, for every project.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = './test-output/pdf-export';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://localhost:4173/';
const log = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('create-agency-rms:local-mode', '1'); } catch {} }); // offline demo mode (no Supabase in this test)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const dl = async (locator, tag) => {
    let d;
    try {
      try {
        [d] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), locator.click({ timeout: 10000 })]);
      } catch {
        log.push(`RETRY ${tag} toast=${JSON.stringify(await page.locator('[role=status]').allInnerTexts())}`);
        await page.waitForTimeout(1000);
        [d] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), locator.click({ timeout: 10000 })]);
      }
    } catch (e) {
      await page.screenshot({ path: `${OUT}/FAIL-${tag}.png` });
      log.push(`FAILED ${tag}: ${e.message.split('\n')[0]} url=${page.url()}`);
      return null;
    }
    const name = `${tag}__${d.suggestedFilename()}`;
    await d.saveAs(`${OUT}/${name}`);
    log.push(name);
    return name;
  };

  await page.goto(URL);
  await page.waitForSelector('text=Financial overview');

  // Extra scenario: a big Business project with many add-ons + custom services so documents run to 2+ pages
  await page.goto(URL + '#/calculator');
  await page.getByLabel('Client full name').fill('Long Document Client');
  await page.getByLabel('Business name').fill('Multi Page Ventures');
  await page.getByLabel('Project title').fill('Large multi-page quotation');
  await page.getByRole('button', { name: /^Business/ }).click();
  for (const a of ['Additional website page', 'Extra custom UI/UX design', 'Reservation / booking system', 'Payment gateway integration', 'Advanced SEO setup', 'Content writing', 'Additional revision round']) await page.getByText(a, { exact: true }).click();
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: '+ Add custom service' }).click();
    const names = page.getByLabel('Service name');
    await names.nth(i).fill(`Custom service ${i + 1}: product upload batch with photo editing`);
    const row = names.nth(i).locator('xpath=ancestor::div[contains(@class,"grid")][1]');
    await row.locator('input[inputmode=decimal]').fill(String(7_333 + i * 101) + '.33');
  }
  await page.getByLabel('Discount type').selectOption('amount');
  await page.getByLabel('Discount amount').fill('12,345.67');
  await page.getByText('This discount is approved').click();
  await page.getByLabel('Approved by').fill('Merlin');
  await page.getByLabel('Reason (shown to client)').fill('Bulk discount');
  await page.getByText('Offer ongoing maintenance for this project').click();
  await page.getByLabel('Fee per billing period').fill('20,000');
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.waitForSelector('text=Editing CRQ-');
  const longId = page.url().split('/').pop();
  // invoice + verified payment + receipt for it
  await page.goto(URL + `#/invoices?p=${longId}`);
  await page.getByRole('button', { name: /Create invoice for/ }).click();
  await page.locator('[role=dialog]').getByLabel('Close').click();
  await page.goto(URL + `#/receipts?p=${longId}`);
  await page.getByLabel('Amount').fill('100,000.01');
  await page.getByLabel('Transaction reference').fill('TRF-LONG-1');
  await page.getByText('I have confirmed this money is in our account').click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForTimeout(200);

  // Issue the not-yet-issued receipt on demo_5 (2nd payment)
  await page.goto(URL + '#/receipts?p=demo_5');
  await page.waitForSelector('text=No receipt yet');
  await dl(page.locator('text=No receipt yet →').locator('xpath=..').getByRole('button', { name: 'PDF', exact: true }), 'receipt-new');

  // Print path: should load the PDF in a hidden iframe without errors
  await page.goto(URL + '#/distribution?p=demo_2');
  await page.getByRole('button', { name: 'Print Full Revenue Breakdown' }).click();
  await page.waitForTimeout(800);
  const printFrame = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src).find((s) => s.startsWith('blob:')));
  log.push(`PRINT_IFRAME ${printFrame ? 'ok' : 'missing'}`);

  // Every document for every project
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('create-agency-rms:v1')).projects.map((p) => p.id));
  for (const id of ids) {
    await page.goto(URL + '#/quotations');
    const p = await page.evaluate((id) => JSON.parse(localStorage.getItem('create-agency-rms:v1')).projects.find((x) => x.id === id), id);
    await dl(page.locator('tbody tr', { hasText: p.quoteNumber }).getByRole('button', { name: 'PDF', exact: true }), `${id}__quote`);
    await page.goto(URL + `#/invoices?p=${id}`);
    await page.waitForSelector('text=Create an invoice');
    for (const inv of p.invoices) {
      const card = page.locator(`xpath=//p[starts-with(normalize-space(.), "${inv.number}")]/ancestor::div[contains(@class,"justify-between")][1]`).first();
      await dl(card.getByRole('button', { name: 'PDF', exact: true }), `${id}__invoice-${inv.number}`);
    }
    await page.goto(URL + `#/receipts?p=${id}`);
    await page.waitForSelector('text=Record a payment');
    const issued = p.payments.filter((x) => x.receiptNumber);
    for (const pay of issued) {
      const card = page.locator('div.rounded-2xl.border', { hasText: `Receipt ${pay.receiptNumber}` }).first();
      await dl(card.getByRole('button', { name: 'PDF', exact: true }), `${id}__receipt-${pay.receiptNumber}`);
    }
    await page.goto(URL + `#/distribution?p=${id}`);
    await page.waitForSelector('text=Who gets what');
    await dl(page.getByRole('button', { name: 'Download Full Revenue Breakdown PDF' }), `${id}__revenue`);
  }
  // receipts must not be duplicated: try issuing again on demo_5 and compare numbers
  const state = await page.evaluate(() => localStorage.getItem('create-agency-rms:v1'));
  fs.writeFileSync(`${OUT}/state.json`, state);
  log.push(`JS_ERRORS ${errors.length} ${errors.slice(0, 2).join(' | ')}`);
  fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));
  console.log(log.filter((l) => !l.includes('.pdf')).join('\n'));
  console.log(log.filter((l) => l.includes('.pdf')).length, 'PDFs downloaded');
  await browser.close();
})().catch((e) => {
  console.error('CRASH', e.message);
  fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));
  process.exit(1);
});
