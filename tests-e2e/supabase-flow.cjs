// End-to-end test of login, shared database, conflicts, security and password reset
// against a local Supabase stand-in (real Postgres + real Supabase Auth (GoTrue) + PostgREST).
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.APP_URL || 'http://localhost:4173/';
const API = process.env.API_URL || 'http://localhost:54321';
const ANON = process.env.ANON_KEY;
const PW = 'Test-Pass-2026!';
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
const sql = (q) => require('child_process').execSync(`psql -h /home/pgtest/pg -p 55432 -U postgres -d sb -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

async function login(browser, email, password = PW) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    // Network status lines (expected 400 on a deliberate conflict, offline test) are not app errors; CSP blocks ("Refused to…") and crashes are.
    if (m.type() === 'error' && !/Failed to load resource|realtime|websocket|WebSocket/i.test(m.text())) page.errors.push(m.text());
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return { ctx, page };
}
const synced = (page) => page.waitForSelector('[data-sync="saved"]', { timeout: 10000 });

async function resetTestPasswords() {
  const SVC = process.env.SERVICE_KEY;
  if (!SVC) return;
  const users = (await (await fetch(API + '/auth/v1/admin/users', { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } })).json()).users;
  for (const u of users) await fetch(API + '/auth/v1/admin/users/' + u.id, { method: 'PUT', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PW }) });
}

(async () => {
  await resetTestPasswords();
  const browser = await chromium.launch();

  // ---- 1. Nothing is visible before signing in
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route(/fonts\./, (r) => r.abort());
    await page.goto(URL + '#/distribution');
    await page.waitForSelector('text=Sign in');
    ok('Login screen shown before any data (even on a deep link)', !(await page.isVisible('text=Revenue distribution')) && (await page.isVisible('text=team access only')));
    await page.getByLabel('Email').fill('merlin@createagency.io');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForSelector('text=Email or password is not correct');
    ok('Wrong password rejected', true);
    await ctx.close();
  }

  // ---- 2. A real login that is NOT on the team list
  {
    const { ctx, page } = await login(browser, 'stranger@gmail.com');
    await page.waitForSelector('text=Access not approved');
    ok('Signed-in account not on team list is refused', !(await page.isVisible('text=Financial overview')));
    await ctx.close();
  }

  // ---- 3. Merlin signs in to an empty database and loads demo data
  sql('delete from public.projects; delete from public.app_settings; update public.doc_counters set next = 1;');
  const merlin = await login(browser, 'merlin@createagency.io');
  const mp = merlin.page;
  await mp.waitForSelector('text=Financial overview');
  ok('Merlin signs in', true);
  ok('First login stores default settings in the database', sql('select count(*) from public.app_settings') === '1');
  await mp.goto(URL + '#/settings');
  await mp.getByRole('button', { name: 'Reset to demo data' }).click();
  await mp.getByRole('button', { name: 'Reset to demo', exact: true }).click();
  await mp.waitForSelector('text=Demo data loaded');
  ok('Demo data saved to the shared database', sql('select count(*) from public.projects') === '5');
  ok('Team list shown in Settings', await mp.isVisible('text=jonathan@createagency.io'));

  // ---- 4. Merlin creates a project; numbers come from the database
  await mp.goto(URL + '#/calculator');
  await mp.getByLabel('Client full name').fill('Shared Client');
  await mp.getByLabel('Project title').fill('Cloud saved project');
  await mp.getByRole('button', { name: 'Save project' }).click();
  await mp.waitForSelector('text=Editing CRQ-');
  await synced(mp);
  const quoteNo = (await mp.locator('text=/Editing CRQ-/').innerText()).replace(/editing /i, '');
  const sharedId = mp.url().split('/').pop();
  ok('Project saved to database with server-issued number', sql(`select data->>'quoteNumber' from public.projects where id='${sharedId}'`) === quoteNo, quoteNo);
  ok('Sync indicator shows "All changes saved"', await mp.isVisible('text=All changes saved'));

  // ---- 5. Tyson on another device sees it
  const tyson = await login(browser, 'tyson@createagency.io');
  const tp = tyson.page;
  await tp.waitForSelector('text=Financial overview');
  await tp.goto(URL + '#/history');
  ok('Tyson (another device) sees Merlin’s project', await tp.isVisible('text=Cloud saved project'));

  // ---- 6. Simultaneous edits → conflict is caught, not silently overwritten
  await tp.goto(URL + `#/calculator/${sharedId}`);
  await tp.getByLabel('Project title').fill('Title by Tyson');
  await tp.getByRole('button', { name: 'Save changes' }).click();
  await synced(tp);
  await mp.getByLabel('Project title').fill('Title by Merlin');
  await mp.getByRole('button', { name: 'Save changes' }).click();
  await mp.waitForSelector('text=Someone else changed this project');
  ok('Conflict detected when two people edit the same project', true);
  ok('Database still has Tyson’s save (no silent overwrite)', sql(`select data->>'title' from public.projects where id='${sharedId}'`) === 'Title by Tyson');
  await mp.getByRole('button', { name: 'Keep my version' }).click();
  await synced(mp);
  ok('“Keep my version” saves Merlin’s copy', sql(`select data->>'title' from public.projects where id='${sharedId}'`) === 'Title by Merlin');
  ok('History keeps every version with who saved it', sql(`select string_agg(changed_by, ',' order by history_id) from public.project_history where project_id='${sharedId}'`) === 'merlin@createagency.io,tyson@createagency.io,merlin@createagency.io');

  // ---- 6b. Merlin's open tab picks up Tyson's later change when he returns to it
  await tp.goto(URL + `#/calculator/${sharedId}`);
  await tp.reload(); // Tyson refreshes first so he is editing the latest version
  await tp.waitForSelector('text=Client and project');
  await tp.getByLabel('Business name').fill('Updated by Tyson');
  await tp.getByRole('button', { name: 'Save changes' }).click();
  await synced(tp);
  await mp.goto(URL + '#/history');
  await mp.evaluate(() => { Date.now = ((n) => () => n() + 60000)(Date.now.bind(Date)); window.dispatchEvent(new Event('focus')); });
  await mp.waitForSelector('text=Updated by Tyson', { timeout: 10000 }).catch(() => {});
  ok('Teammate changes appear when you return to the tab', await mp.isVisible('text=Updated by Tyson'));

  // ---- 7. Payments + receipt numbers through the database
  await mp.goto(URL + `#/receipts?p=${sharedId}`);
  await mp.getByLabel('Amount').fill('50,000');
  await mp.getByText('I have confirmed this money is in our account').click();
  await mp.getByRole('button', { name: 'Record payment' }).click();
  await synced(mp);
  const [rd] = await Promise.all([mp.waitForEvent('download'), mp.getByRole('button', { name: 'PDF', exact: true }).first().click()]);
  await synced(mp);
  const rNo = rd.suggestedFilename().split('-Receipt')[0];
  ok('Receipt number issued by database and stored on payment', sql(`select data->'payments'->0->>'receiptNumber' from public.projects where id='${sharedId}'`) === rNo, rNo);

  // ---- 8. Offline: change kept and saved when the connection returns
  await merlin.ctx.setOffline(true);
  await mp.goto(URL + `#/calculator/${sharedId}`).catch(() => {});
  await mp.getByLabel('Project description').fill('Typed while offline');
  await mp.getByRole('button', { name: 'Save changes' }).click();
  await mp.waitForSelector('[data-sync="offline"]', { timeout: 15000 });
  ok('Offline: app says it will retry (nothing lost)', await mp.isVisible('text=No connection'));
  await merlin.ctx.setOffline(false);
  await mp.waitForSelector('[data-sync="saved"]', { timeout: 40000 });
  ok('Back online: change saved automatically', sql(`select data->>'description' from public.projects where id='${sharedId}'`) === 'Typed while offline');

  // ---- 9. Jonathan on a fresh device sees everything (data not tied to one browser)
  const jon = await login(browser, 'jonathan@createagency.io');
  await jon.page.waitForSelector('text=Financial overview');
  await jon.page.goto(URL + `#/receipts?p=${sharedId}`);
  ok('Jonathan (fresh browser) sees payments and receipt', await jon.page.isVisible(`text=Receipt ${rNo}`));
  await jon.ctx.close();

  // ---- 10. Direct database access attempts are blocked
  const call = async (path, token, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, body: await r.text() };
  };
  const anonRead = await call('/rest/v1/projects?select=id', ANON);
  ok('Anonymous API read of projects blocked', anonRead.status === 401 || anonRead.status === 403 || anonRead.body === '[]', `${anonRead.status} ${anonRead.body.slice(0, 60)}`);
  const anonRpc = await call('/rest/v1/rpc/next_doc_number', ANON, { method: 'POST', body: JSON.stringify({ p_kind: 'quote' }) });
  ok('Anonymous API cannot call database functions', anonRpc.status >= 400, String(anonRpc.status));
  const tok = await (await fetch(API + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'stranger@gmail.com', password: PW }) })).json();
  const strangerRead = await call('/rest/v1/projects?select=id', tok.access_token);
  ok('Non-member with valid login reads 0 projects', strangerRead.body === '[]', strangerRead.body.slice(0, 40));
  const strangerWrite = await call('/rest/v1/rpc/save_project', tok.access_token, { method: 'POST', body: JSON.stringify({ p_id: 'x', p_data: { id: 'x' }, p_expected_version: null }) });
  ok('Non-member cannot write', strangerWrite.status >= 400 && /not_authorized/.test(strangerWrite.body), String(strangerWrite.status));
  const mtok = await (await fetch(API + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tyson@createagency.io', password: PW }) })).json();
  const directWrite = await call('/rest/v1/projects', mtok.access_token, { method: 'POST', body: JSON.stringify({ id: 'hack', data: {} }) });
  ok('Even members cannot bypass the version check with direct table writes', directWrite.status >= 400, String(directWrite.status));
  const signup = await fetch(API + '/auth/v1/signup', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'new@x.com', password: 'Abcdef-12345' }) });
  ok('Public sign-up is disabled', signup.status >= 400, String(signup.status));

  // ---- 11. Sign out
  await tp.goto(URL);
  await tp.getByRole('button', { name: 'Sign out' }).first().click();
  await tp.waitForSelector('text=Sign in');
  await tp.goto(URL + '#/history');
  ok('After sign-out, data pages show the login screen', await tp.isVisible('text=team access only') && !(await tp.isVisible('text=Cloud saved project')));
  await tyson.ctx.close();

  // ---- 12. Forgot password → email link → new password → sign in
  {
    try { fs.unlinkSync('/home/pgtest/run/last-email.txt'); } catch {}
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route(/fonts\./, (r) => r.abort());
    await page.goto(URL);
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email').fill('jonathan@createagency.io');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.waitForSelector('text=reset link is on its way');
    let mail = '';
    for (let i = 0; i < 30 && !mail; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try { mail = fs.readFileSync('/home/pgtest/run/last-email.txt', 'utf8'); } catch {}
    }
    const decoded = mail.replace(/=\r?\n/g, '').replace(/=3D/g, '=').replace(/&amp;/g, '&');
    const link = (decoded.match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/) || [])[0];
    ok('Reset email sent with a link', !!link);
    await page.goto(link);
    await page.waitForSelector('text=Choose a new password', { timeout: 15000 });
    await page.getByLabel('New password (at least 10 characters)').fill('short');
    await page.getByLabel('Type it again').fill('short');
    await page.getByRole('button', { name: 'Save new password' }).click();
    ok('Weak new password rejected', await page.isVisible('text=at least 10 characters'));
    await page.getByLabel('New password (at least 10 characters)').fill('Brand-New-Pass-99');
    await page.getByLabel('Type it again').fill('Brand-New-Pass-99');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.waitForSelector('text=Financial overview', { timeout: 15000 });
    ok('Password reset signs Jonathan in', true);
    await ctx.close();
    const again = await login(browser, 'jonathan@createagency.io', 'Brand-New-Pass-99');
    await again.page.waitForSelector('text=Financial overview');
    ok('New password works on next sign-in', true);
    await again.ctx.close();
  }

  // ---- 13. Automatic sign-out after inactivity
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route(/fonts\./, (r) => r.abort());
    await page.clock.install();
    await page.goto(URL);
    await page.getByLabel('Email').fill('merlin@createagency.io');
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForSelector('text=Financial overview');
    await page.clock.fastForward('31:00');
    await page.waitForSelector('text=signed out after 30 minutes', { timeout: 15000 });
    ok('Idle for 30 minutes → signed out automatically', true);
    await ctx.close();
  }

  ok('No JavaScript errors (incl. CSP violations) for Merlin', mp.errors.length === 0, mp.errors.slice(0, 2).join(' | '));
  await merlin.ctx.close();
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('CRASH', e.message.split('\n')[0]);
  process.exit(1);
});
