import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmModal, Field, MoneyInput, Notice, PageHeader, PercentInput, cx } from '../components/ui';
import { formatDocNumber, uid } from '../lib/calc';
import { BPS_100, bpsToPercentText } from '../lib/money';
import { useStore } from '../lib/store';
import type { Settings as SettingsT } from '../lib/types';
import { quotationPdf } from '../pdf/documents';
import { usePdf } from '../components/pdf-preview';
import { demoData } from '../lib/demo';
import { BackupButtons } from './History';
import { useSession } from '../components/AuthGate';

function splitText(s: SettingsT) {
  return s.split.map((x) => `${x.name} ${bpsToPercentText(x.bps)}`).join(', ');
}

async function resizeLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 600 / img.width, 240 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Settings() {
  const { data, updateSettings, toast, clearDemo, resetEverything, backendKind, members } = useStore();
  const session = useSession();
  const pdf = usePdf();
  const [d, setD] = useState<SettingsT>(() => structuredClone(data.settings));
  const [base, setBase] = useState<SettingsT>(() => structuredClone(data.settings));
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [confirmSplit, setConfirmSplit] = useState(false);
  const [confirmReset, setConfirmReset] = useState<null | 'demo' | 'empty'>(null);
  const [team, setTeam] = useState<{ email: string; display_name: string }[] | null>(null);
  // Document counters change whenever anyone issues a number, so they don't count as "your" edits.
  const sameIgnoringCounters = (a: SettingsT, b: SettingsT) => JSON.stringify({ ...a, numbering: { ...a.numbering, nextQuote: 0, nextInvoice: 0, nextReceipt: 0 } }) === JSON.stringify({ ...b, numbering: { ...b.numbering, nextQuote: 0, nextInvoice: 0, nextReceipt: 0 } });
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  useEffect(() => {
    if (!dirty) {
      setD(structuredClone(data.settings));
      setBase(structuredClone(data.settings));
      setChangedElsewhere(false);
    } else if (!sameIgnoringCounters(base, data.settings)) setChangedElsewhere(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.settings]);
  useEffect(() => {
    members().then(setTeam).catch(() => setTeam([]));
  }, [members]);
  const splitSum = d.split.reduce((a, x) => a + x.bps, 0);
  const splitChanged = JSON.stringify(d.split) !== JSON.stringify(data.settings.split);
  const errors: string[] = [];
  if (splitSum !== BPS_100) errors.push(`Revenue split adds up to ${bpsToPercentText(splitSum)} — it must be exactly 100%.`);
  if (d.split.some((x) => !x.name.trim())) errors.push('Every person in the split needs a name.');
  if (d.packages.some((p) => !p.name.trim())) errors.push('Every package needs a name.');
  if (d.addons.some((a) => !a.name.trim())) errors.push('Every add-on needs a name.');
  if (!d.numbering.quotePrefix.trim() || !d.numbering.invoicePrefix.trim() || !d.numbering.receiptPrefix.trim()) errors.push('Document prefixes cannot be empty.');
  if (new Set([d.numbering.quotePrefix, d.numbering.invoicePrefix, d.numbering.receiptPrefix]).size < 3) errors.push('Quotation, invoice and receipt prefixes must all be different.');
  if (d.depositBps <= 0 || d.depositBps >= BPS_100) errors.push('Deposit must be between 0% and 100%.');

  function commit() {
    const next = structuredClone(d);
    if (splitChanged) next.splitChangeLog = [...next.splitChangeLog, { at: new Date().toISOString(), from: splitText(data.settings), to: splitText(next) }];
    updateSettings(() => next);
    setD(structuredClone(next));
    setBase(structuredClone(next));
    setChangedElsewhere(false);
    toast('Settings saved');
  }

  function save() {
    if (errors.length) return toast(errors[0], 'err');
    if (splitChanged) return setConfirmSplit(true);
    commit();
  }

  const patch = (fn: (s: SettingsT) => void) =>
    setD((cur) => {
      const n = structuredClone(cur);
      fn(n);
      return n;
    });

  return (
    <div className="pb-24">
      <PageHeader eyebrow="Administrator" title="Settings" />
      {changedElsewhere && (
        <div className="mb-4">
          <Notice>
            A teammate changed the settings while you were editing. Saving now will replace their changes.{' '}
            <button className="font-medium underline" onClick={() => { setD(structuredClone(data.settings)); setBase(structuredClone(data.settings)); setChangedElsewhere(false); }}>
              Load their version
            </button>
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Company details" subtitle="Shown on every PDF">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name">{(id) => <input id={id} className="input" value={d.company.name} onChange={(e) => patch((s) => (s.company.name = e.target.value))} />}</Field>
            <Field label="Website">{(id) => <input id={id} className="input" value={d.company.website} onChange={(e) => patch((s) => (s.company.website = e.target.value))} />}</Field>
            <Field label="Contact email">{(id) => <input id={id} type="email" className="input" value={d.company.email} onChange={(e) => patch((s) => (s.company.email = e.target.value))} />}</Field>
            <Field label="Phone (optional)">{(id) => <input id={id} className="input" value={d.company.phone} onChange={(e) => patch((s) => (s.company.phone = e.target.value))} />}</Field>
            <Field label="Address / city" className="sm:col-span-2">{(id) => <input id={id} className="input" value={d.company.address} onChange={(e) => patch((s) => (s.company.address = e.target.value))} />}</Field>
            <Field label="Logo (PNG or JPG)" className="sm:col-span-2" hint="Used at the top of PDFs. Leave empty to use the C.R.E.A.T.E. wordmark.">
              {(id) => (
                <div className="flex flex-wrap items-center gap-3">
                  {d.company.logoDataUrl && <img src={d.company.logoDataUrl} alt="Logo preview" className="h-12 rounded-lg border border-line bg-white p-1" />}
                  <input
                    id={id}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="text-xs"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const url = await resizeLogo(f);
                        patch((s) => (s.company.logoDataUrl = url));
                      } catch {
                        toast('That image could not be read.', 'err');
                      }
                    }}
                  />
                  {d.company.logoDataUrl && (
                    <Button size="sm" variant="danger" onClick={() => patch((s) => (s.company.logoDataUrl = ''))}>
                      Remove logo
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>
        </Card>

        <Card title="Revenue split" subtitle="Applies to new projects. Existing projects keep the split they were created with.">
          <div className="space-y-3">
            {d.split.map((p, i) => (
              <div key={p.id} className="grid grid-cols-[1fr_1fr_110px] items-end gap-2">
                <Field label={p.isAgency ? 'Agency' : `Person ${i + 1}`}>{(id) => <input id={id} className="input" value={p.name} onChange={(e) => patch((s) => (s.split[i].name = e.target.value))} />}</Field>
                <Field label="Role">{(id) => <input id={id} className="input" value={p.role} disabled={p.isAgency} onChange={(e) => patch((s) => (s.split[i].role = e.target.value))} />}</Field>
                <Field label="Share">{(id) => <PercentInput id={id} value={p.bps} onChange={(v) => patch((s) => (s.split[i].bps = v))} />}</Field>
              </div>
            ))}
            <p className={cx('text-sm font-medium', splitSum === BPS_100 ? 'text-emerald-700' : 'text-red-600')}>Total: {bpsToPercentText(splitSum)} {splitSum === BPS_100 ? '✓' : '— must be 100%'}</p>
            {splitChanged && <Notice>You changed the commission split. You’ll be asked to confirm when you save.</Notice>}
            {d.split.map((x) => x.bps).join() !== '2500,2500,5000' && (
              <Button size="sm" onClick={() => patch((s) => s.split.forEach((x) => (x.bps = x.isAgency ? 5000 : 2500)))}>
                Restore default 25% / 25% / 50%
              </Button>
            )}
            {d.splitChangeLog.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Change history ({d.splitChangeLog.length})</summary>
                <ul className="mt-2 space-y-1">
                  {d.splitChangeLog.map((l) => (
                    <li key={l.at}>
                      {new Date(l.at).toLocaleString()}: {l.from} → {l.to}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Card>

        <Card title="Packages" subtitle="Prices fill in automatically in the calculator" className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.packages.map((p, i) => (
              <div key={p.id} className="space-y-3 rounded-2xl border border-line bg-cream/50 p-4">
                <div className="grid grid-cols-[1fr_150px] gap-2">
                  <Field label="Name">{(id) => <input id={id} className="input" value={p.name} onChange={(e) => patch((s) => (s.packages[i].name = e.target.value))} />}</Field>
                  {p.priceKobo === null ? (
                    <Field label="Price">{() => <div className="flex h-[38px] items-center"><Badge>Consultation</Badge></div>}</Field>
                  ) : (
                    <Field label="Price">{(id) => <MoneyInput id={id} value={p.priceKobo} onChange={(v) => patch((s) => (s.packages[i].priceKobo = v ?? 0))} />}</Field>
                  )}
                </div>
                <Field label="What's included (one per line)">{(id) => <textarea id={id} rows={4} className="input text-xs" value={p.inclusions.join('\n')} onChange={(e) => patch((s) => (s.packages[i].inclusions = e.target.value.split('\n')))} />}</Field>
                <div>
                  <p className="label">Add-ons already included (can’t be charged again)</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {d.addons.map((a) => (
                      <Checkbox
                        key={a.id}
                        checked={p.includedAddonIds.includes(a.id)}
                        onChange={(v) => patch((s) => (s.packages[i].includedAddonIds = v ? [...s.packages[i].includedAddonIds, a.id] : s.packages[i].includedAddonIds.filter((x) => x !== a.id)))}
                        label={<span className="text-xs">{a.name}</span>}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Premium / Custom never shows a fixed price; you enter the agreed price on each project.</p>
        </Card>

        <Card
          title="Add-on services and prices"
          className="lg:col-span-2"
          actions={
            <Button size="sm" variant="soft" onClick={() => patch((s) => s.addons.push({ id: uid('ad_'), name: 'New service', unitPriceKobo: 0, unit: 'flat', description: '', allowQuantity: true }))}>
              + Add service
            </Button>
          }
        >
          <div className="space-y-3">
            {d.addons.map((a, i) => (
              <div key={a.id} className="grid gap-2 rounded-2xl border border-line bg-white p-3 md:grid-cols-[1.3fr_140px_110px_2fr_auto_auto] md:items-center">
                <input className="input" value={a.name} onChange={(e) => patch((s) => (s.addons[i].name = e.target.value))} aria-label="Service name" />
                <MoneyInput value={a.unitPriceKobo} onChange={(v) => patch((s) => (s.addons[i].unitPriceKobo = v ?? 0))} />
                <input className="input" value={a.unit} onChange={(e) => patch((s) => (s.addons[i].unit = e.target.value))} aria-label="Unit" placeholder="per page" />
                <input className="input" value={a.description} onChange={(e) => patch((s) => (s.addons[i].description = e.target.value))} aria-label="Description" placeholder="Description" />
                <Checkbox checked={a.allowQuantity} onChange={(v) => patch((s) => (s.addons[i].allowQuantity = v))} label={<span className="text-xs">Quantity</span>} />
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    patch((s) => {
                      s.addons.splice(i, 1);
                      s.packages.forEach((p) => (p.includedAddonIds = p.includedAddonIds.filter((x) => x !== a.id)));
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Changing a price here affects new selections only. Saved projects keep the price they were quoted at.</p>
        </Card>

        <Card title="Payments and documents">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Deposit" hint={`Balance on delivery: ${bpsToPercentText(BPS_100 - d.depositBps)}`}>{(id) => <PercentInput id={id} value={d.depositBps} onChange={(v) => patch((s) => (s.depositBps = v))} />}</Field>
            <Field label="Payment terms (days)">{(id) => <input id={id} type="number" min={0} max={120} className="input" value={d.paymentTermsDays} onChange={(e) => patch((s) => (s.paymentTermsDays = Math.max(0, Math.min(120, Number(e.target.value) || 0))))} />}</Field>
            <Field label="Quote valid for (days)">{(id) => <input id={id} type="number" min={1} max={180} className="input" value={d.quoteValidityDays} onChange={(e) => patch((s) => (s.quoteValidityDays = Math.max(1, Math.min(180, Number(e.target.value) || 1))))} />}</Field>
            <Field label="Payment instructions note" className="sm:col-span-3">{(id) => <input id={id} className="input" value={d.paymentInstructionsNote} onChange={(e) => patch((s) => (s.paymentInstructionsNote = e.target.value))} />}</Field>
            <Field label="Default scope and assumptions (one per line)" className="sm:col-span-3">{(id) => <textarea id={id} rows={4} className="input text-xs" value={d.defaultAssumptions} onChange={(e) => patch((s) => (s.defaultAssumptions = e.target.value))} />}</Field>
            <Field label="Default terms and conditions (one per line)" className="sm:col-span-3">{(id) => <textarea id={id} rows={5} className="input text-xs" value={d.defaultTerms} onChange={(e) => patch((s) => (s.defaultTerms = e.target.value))} />}</Field>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Document numbering">
            <div className="grid gap-3 sm:grid-cols-3">
              {(['quote', 'invoice', 'receipt'] as const).map((k) => {
                const pk = `${k}Prefix` as const;
                const nk = `next${k[0].toUpperCase()}${k.slice(1)}` as 'nextQuote' | 'nextInvoice' | 'nextReceipt';
                return (
                  <div key={k} className="space-y-2">
                    <Field label={`${k[0].toUpperCase()}${k.slice(1)} prefix`}>{(id) => <input id={id} className="input uppercase" value={d.numbering[pk]} onChange={(e) => patch((s) => (s.numbering[pk] = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)))} />}</Field>
                    <Field label="Next number">{(id) => <input id={id} type="number" min={1} className="input" value={d.numbering[nk]} onChange={(e) => patch((s) => (s.numbering[nk] = Math.max(1, Math.floor(Number(e.target.value) || 1))))} />}</Field>
                    <p className="tnum text-xs text-muted">Next: {formatDocNumber(d.numbering[pk], d.numbering[nk], d.numbering.includeYear)}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <Checkbox checked={d.numbering.includeYear} onChange={(v) => patch((s) => (s.numbering.includeYear = v))} label="Include the year in numbers" />
            </div>
            <p className="mt-2 text-xs text-muted">Numbers that are already used are always skipped, so documents are never duplicated.</p>
          </Card>

          <Card title="PDF branding">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Accent colour">
                {(id) => (
                  <div className="flex items-center gap-2">
                    <input id={id} type="color" className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-white" value={d.pdf.accent} onChange={(e) => patch((s) => (s.pdf.accent = e.target.value))} />
                    <code className="text-xs">{d.pdf.accent}</code>
                  </div>
                )}
              </Field>
              <Field label="Currency label in PDFs">
                {(id) => (
                  <select id={id} className="input" value={d.pdf.currencyLabel} onChange={(e) => patch((s) => (s.pdf.currencyLabel = e.target.value as 'symbol' | 'code'))}>
                    <option value="symbol">₦ symbol (₦129,999.00)</option>
                    <option value="code">NGN code (NGN 129,999.00)</option>
                  </select>
                )}
              </Field>
              <Field label="Footer message" className="sm:col-span-2">{(id) => <input id={id} className="input" value={d.pdf.footerNote} onChange={(e) => patch((s) => (s.pdf.footerNote = e.target.value))} />}</Field>
            </div>
            <Button className="mt-3" size="sm" onClick={() => { const sample = demoData().projects[1]; pdf.preview(() => quotationPdf(sample, d), 'sample-quotation.pdf', 'Sample quotation with these settings'); }}>
              Preview a sample PDF with these settings
            </Button>
          </Card>

          <Card title="Team and sign-in" subtitle={backendKind === 'supabase' ? 'Everyone on this list can sign in and see all records' : 'Offline demo mode'}>
            {backendKind === 'supabase' ? (
              <div className="space-y-3 text-sm">
                <p>
                  Signed in as <b>{session.email}</b>. You’re signed out automatically after {session.idleMinutes} minutes without activity.
                </p>
                <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                  {(team ?? []).map((m) => (
                    <li key={m.email} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="font-medium">{m.display_name || m.email}</span>
                      <span className="truncate text-xs text-muted">{m.email}</span>
                    </li>
                  ))}
                  {team === null && <li className="px-3 py-2 text-xs text-muted">Loading…</li>}
                </ul>
                <p className="text-xs text-muted">To add or remove someone, follow “Add a team member” in the SETUP-GUIDE (it’s done in your Supabase dashboard, so no one can add themselves).</p>
                <Button size="sm" onClick={session.signOut}>
                  Sign out
                </Button>
              </div>
            ) : (
              <Notice>You are in offline demo mode: no password, and data stays in this browser only. Connect your Supabase database to use logins and shared data.</Notice>
            )}
          </Card>

          <Card title="Data and backups" subtitle={backendKind === 'supabase' ? 'Saved in your shared Supabase database' : 'Stored in this browser only'}>
            <Notice tone={backendKind === 'supabase' ? 'green' : 'amber'}>
              {backendKind === 'supabase'
                ? 'Every change is saved to your online database and shows up for Tyson and Jonathan automatically. The database also keeps a history of every change to every project. A JSON backup is still a good idea once a month.'
                : 'Your data lives in this browser only. It won’t appear on another device and can be lost if browser data is cleared.'}
            </Notice>
            <div className="mt-3 flex flex-wrap gap-2">
              <BackupButtons />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button size="sm" onClick={() => void clearDemo().then(() => toast('Demo projects removed')).catch((e: Error) => toast(e.message, 'err'))}>
                Clear demo projects
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmReset('empty')}>
                Erase everything
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmReset('demo')}>
                Reset to demo data
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{errors.length ? <span className="text-red-600">{errors[0]}</span> : 'You have unsaved settings.'}</p>
            <div className="flex gap-2">
              <Button onClick={() => { setD(structuredClone(data.settings)); setBase(structuredClone(data.settings)); setChangedElsewhere(false); }}>Discard</Button>
              <Button variant="primary" onClick={save} disabled={errors.length > 0}>
                Save settings
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmSplit}
        title="Change the commission split?"
        confirmLabel="Yes, save new split"
        message={
          <div className="space-y-2">
            <p>
              From: <b>{splitText(data.settings)}</b>
            </p>
            <p>
              To: <b>{splitText(d)}</b>
            </p>
            <p className="text-muted">New projects will use this split. Existing projects are not changed. The change is recorded in the change history.</p>
          </div>
        }
        onClose={() => setConfirmSplit(false)}
        onConfirm={commit}
      />
      <ConfirmModal
        open={!!confirmReset}
        title={confirmReset === 'demo' ? 'Reset to demo data?' : 'Erase all data?'}
        danger
        confirmLabel={confirmReset === 'demo' ? 'Reset to demo' : 'Erase everything'}
        message={`All ${data.projects.length} projects and the settings will be replaced${confirmReset === 'demo' ? ' with the demo data' : ''}${backendKind === 'supabase' ? ' for the whole team' : ''}. Export a backup first.${backendKind === 'supabase' ? ' (The database keeps a history copy of every deleted project.)' : ''}`}
        onClose={() => setConfirmReset(null)}
        onConfirm={() => {
          const demo = confirmReset === 'demo';
          resetEverything(demo)
            .then(() => toast(demo ? 'Demo data loaded' : 'All data erased'))
            .catch((e: Error) => toast(e.message, 'err'));
        }}
      />
    </div>
  );
}
