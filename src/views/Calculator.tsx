import { useEffect, useMemo, useState } from 'react';
import { useDocs } from '../components/doc-actions';
import { Badge, Button, Card, Checkbox, Field, MoneyInput, Notice, PageHeader, PercentInput, QtyInput, cx, paymentTone } from '../components/ui';
import { addDays, computeTotals, distribution, includedAddonIds, maintenanceSummary, paymentSummary, uid, validateProject } from '../lib/calc';
import { blankProject, lineFromAddon } from '../lib/factory';
import { useDuplicate } from '../components/shared';
import { bpsToPercentText, formatNaira } from '../lib/money';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import type { LineItem, MaintenanceFrequency, Project, ProjectStatus } from '../lib/types';

const STATUSES: ProjectStatus[] = ['Quotation', 'Approved', 'In progress', 'Delivered', 'Completed', 'On hold', 'Cancelled'];

export function Calculator({ editId }: { editId: string | null }) {
  const { data, upsertProject, takeNumber, toast } = useStore();
  const s = data.settings;
  const docs = useDocs();
  const existing = editId ? data.projects.find((p) => p.id === editId) ?? null : null;
  const [draft, setDraft] = useState<Project>(() => existing ?? blankProject(s));
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);

  // When switching between projects (or to "new"), reload the draft.
  useEffect(() => {
    setDraft(existing ?? blankProject(s));
    setShowErrors(false);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (fn: (p: Project) => Project) => {
    setDraft((d) => fn(structuredClone(d)));
    setDirty(true);
  };
  const set = <K extends keyof Project>(k: K, v: Project[K]) => update((p) => ({ ...p, [k]: v }));

  const errors = useMemo(() => validateProject(draft, s, data.projects), [draft, s, data.projects]);
  let totals = null;
  let dist = null;
  try {
    totals = computeTotals(draft);
    dist = distribution(draft);
  } catch {
    /* shown via errors */
  }
  const pay = totals ? paymentSummary(draft, totals) : null;
  const pkg = s.packages.find((x) => x.id === draft.packageId);
  const included = includedAddonIds(s, draft.packageId);
  const isCustom = pkg?.priceKobo === null;
  const splitDiffers = JSON.stringify(draft.split.map((x) => [x.id, x.bps, x.name])) !== JSON.stringify(s.split.map((x) => [x.id, x.bps, x.name]));

  function choosePackage(id: string) {
    const p = s.packages.find((x) => x.id === id)!;
    update((d) => ({ ...d, packageId: p.id, packageName: p.name, basePriceKobo: p.priceKobo ?? (d.packageId === id ? d.basePriceKobo : 0) }));
  }

  function toggleAddon(addonId: string, on: boolean) {
    update((d) => ({ ...d, lineItems: on ? [...d.lineItems, lineFromAddon(s, addonId)] : d.lineItems.filter((l) => l.addonId !== addonId) }));
  }

  function setLine(id: string, patch: Partial<LineItem>) {
    update((d) => ({ ...d, lineItems: d.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }

  const [saving, setSaving] = useState(false);
  const duplicateWithNumbers = useDuplicate();

  async function save(thenPreview = false) {
    setShowErrors(true);
    if (errors.length) {
      toast('Please fix the highlighted problems before saving.', 'err');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const p = structuredClone(draft);
    setSaving(true);
    try {
      if (!p.quoteNumber) p.quoteNumber = await takeNumber('quote');
      if (!p.invoiceNumber) p.invoiceNumber = await takeNumber('invoice');
    } catch (e) {
      setSaving(false);
      toast(`Could not get document numbers: ${(e as Error).message}`, 'err');
      return;
    }
    setSaving(false);
    upsertProject(p);
    setDraft(p);
    setDirty(false);
    toast(existing ? 'Project saved' : `Saved as ${p.quoteNumber}`);
    if (!existing) go(`calculator/${p.id}`);
    if (thenPreview) docs.quotation(p);
  }

  async function duplicate() {
    const copy = await duplicateWithNumbers(draft);
    if (copy) go(`calculator/${copy.id}`);
  }

  const receivedOverTotal = totals && pay && pay.verified > totals.total;

  return (
    <div>
      <PageHeader eyebrow={existing ? `Editing ${existing.quoteNumber}` : 'New project'} title={existing ? draft.title || 'Untitled project' : 'Project calculator'}>
        {existing && <Button onClick={() => void duplicate()}>Duplicate quotation</Button>}
        {existing && <Button onClick={() => go('calculator')}>+ New project</Button>}
      </PageHeader>

      {draft.isDemo && (
        <div className="mb-4">
          <Notice tone="blue">This is a demo record for testing. Clear demo data in Settings before real use.</Notice>
        </div>
      )}
      {showErrors && errors.length > 0 && (
        <div className="mb-4">
          <Notice tone="red">
            <p className="font-medium">Before you can save:</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {receivedOverTotal && (
        <div className="mb-4">
          <Notice tone="red">Verified payments ({formatNaira(pay!.verified)}) are now more than the project total ({formatNaira(totals!.total)}). Check the prices or record a refund note.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* ------------------------------------------------ client */}
          <Card title="Client and project" subtitle="Who the work is for and what it is">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client full name">{(id) => <input id={id} className="input" value={draft.client.fullName} onChange={(e) => update((p) => ({ ...p, client: { ...p.client, fullName: e.target.value } }))} placeholder="e.g. Ngozi Eze" />}</Field>
              <Field label="Business name">{(id) => <input id={id} className="input" value={draft.client.business} onChange={(e) => update((p) => ({ ...p, client: { ...p.client, business: e.target.value } }))} placeholder="e.g. Mama Ngozi Kitchen" />}</Field>
              <Field label="Client email">{(id) => <input id={id} type="email" className="input" value={draft.client.email} onChange={(e) => update((p) => ({ ...p, client: { ...p.client, email: e.target.value } }))} placeholder="name@example.com" />}</Field>
              <Field label="Phone number">{(id) => <input id={id} type="tel" className="input" value={draft.client.phone} onChange={(e) => update((p) => ({ ...p, client: { ...p.client, phone: e.target.value } }))} placeholder="0803 000 0000" />}</Field>
              <Field label="Project title" className="sm:col-span-2">{(id) => <input id={id} className="input" value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Restaurant website with bookings" />}</Field>
              <Field label="Project description" className="sm:col-span-2">{(id) => <textarea id={id} rows={3} className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="What will be built, in plain words. Shown on the quotation." />}</Field>
            </div>
          </Card>

          {/* ------------------------------------------------ package */}
          <Card title="Website package" subtitle="Choosing a package fills in its price automatically">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.packages.map((p) => {
                const active = p.id === draft.packageId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choosePackage(p.id)}
                    className={cx('rounded-2xl border p-4 text-left transition', active ? 'border-ochre bg-ochre-soft/60 ring-2 ring-ochre/30' : 'border-line bg-white hover:border-espresso/30')}
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{p.name}</span>
                      {active && <Badge tone="ochre">Selected</Badge>}
                    </div>
                    <p className="tnum mt-1 text-lg font-semibold text-ink">{p.priceKobo === null ? <span className="text-sm font-medium text-muted">Consultation required</span> : formatNaira(p.priceKobo, { decimals: false })}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">
                      {p.inclusions.slice(0, 4).map((i) => (
                        <li key={i}>✓ {i}</li>
                      ))}
                      {p.inclusions.length > 4 && <li>+ {p.inclusions.length - 4} more</li>}
                    </ul>
                  </button>
                );
              })}
            </div>
            {isCustom && (
              <div className="mt-4 max-w-sm">
                <Field label="Agreed price (after consultation)" hint="Premium / Custom never shows a fixed public price — enter what you agreed with the client.">
                  {(id) => <MoneyInput id={id} value={draft.basePriceKobo} onChange={(v) => set('basePriceKobo', v ?? 0)} />}
                </Field>
              </div>
            )}
            {!isCustom && pkg && pkg.priceKobo !== draft.basePriceKobo && (
              <div className="mt-4">
                <Notice>
                  This project uses {formatNaira(draft.basePriceKobo)} for {pkg.name}; the current price in Settings is {formatNaira(pkg.priceKobo ?? 0)}.{' '}
                  <button className="font-medium underline" onClick={() => set('basePriceKobo', pkg.priceKobo ?? 0)}>
                    Use current price
                  </button>
                </Notice>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------ add-ons */}
          <Card title="Additional services" subtitle="Tick what the client wants. Each charge is listed separately on the quotation.">
            <div className="divide-y divide-line">
              {s.addons.map((a) => {
                const line = draft.lineItems.find((l) => l.addonId === a.id);
                const inc = included.has(a.id);
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-[200px] flex-1">
                      <Checkbox
                        checked={!!line}
                        disabled={inc && !line}
                        onChange={(v) => toggleAddon(a.id, v)}
                        label={
                          <span className="font-medium">
                            {a.name} {inc && <Badge tone="green">Included in {draft.packageName}</Badge>}
                          </span>
                        }
                        hint={`${formatNaira(a.unitPriceKobo, { decimals: false })} ${a.unit}`}
                      />
                    </div>
                    {line && (
                      <div className="flex flex-wrap items-center gap-2">
                        {a.allowQuantity && <QtyInput value={line.qty} onChange={(q) => setLine(line.id, { qty: q })} />}
                        <div className="w-36">
                          <MoneyInput value={line.unitPriceKobo} onChange={(v) => setLine(line.id, { unitPriceKobo: v ?? 0 })} />
                        </div>
                        <span className="tnum w-28 text-right text-sm font-semibold">{formatNaira(line.unitPriceKobo * line.qty)}</span>
                        {inc && line.unitPriceKobo > 0 && <Badge tone="red">Already included — remove</Badge>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Custom services</p>
                <Button size="sm" variant="soft" onClick={() => update((d) => ({ ...d, lineItems: [...d.lineItems, { id: uid('li_'), addonId: null, name: '', description: '', unitPriceKobo: 0, qty: 1 }] }))}>
                  + Add custom service
                </Button>
              </div>
              {draft.lineItems.filter((l) => !l.addonId).length === 0 && <p className="text-xs text-muted">Anything not in the list above — e.g. logo design, product uploads, a mobile app screen.</p>}
              <div className="space-y-3">
                {draft.lineItems
                  .filter((l) => !l.addonId)
                  .map((l) => (
                    <div key={l.id} className="grid gap-2 rounded-2xl border border-line bg-cream/50 p-3 sm:grid-cols-[1fr_130px_auto_auto]">
                      <input className="input" placeholder="Service name" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} aria-label="Service name" />
                      <MoneyInput value={l.unitPriceKobo} onChange={(v) => setLine(l.id, { unitPriceKobo: v ?? 0 })} />
                      <QtyInput value={l.qty} onChange={(q) => setLine(l.id, { qty: q })} />
                      <Button size="sm" variant="danger" onClick={() => update((d) => ({ ...d, lineItems: d.lineItems.filter((x) => x.id !== l.id) }))}>
                        Remove
                      </Button>
                      <input className="input sm:col-span-4" placeholder="Short description (shown on the quotation)" value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} aria-label="Description" />
                    </div>
                  ))}
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------ discount */}
          <Card title="Discount" subtitle="Only applied once it has been explicitly approved">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Discount type">
                {(id) => (
                  <select id={id} className="input" value={draft.discount.type} onChange={(e) => update((p) => ({ ...p, discount: { ...p.discount, type: e.target.value as Project['discount']['type'] } }))}>
                    <option value="none">No discount</option>
                    <option value="amount">Fixed amount (₦)</option>
                    <option value="percent">Percentage (%)</option>
                  </select>
                )}
              </Field>
              {draft.discount.type === 'amount' && (
                <Field label="Discount amount">{(id) => <MoneyInput id={id} value={draft.discount.amountKobo} onChange={(v) => update((p) => ({ ...p, discount: { ...p.discount, amountKobo: v ?? 0 } }))} />}</Field>
              )}
              {draft.discount.type === 'percent' && (
                <Field label="Discount percentage">{(id) => <PercentInput id={id} value={draft.discount.bps} onChange={(v) => update((p) => ({ ...p, discount: { ...p.discount, bps: v } }))} />}</Field>
              )}
              {draft.discount.type !== 'none' && (
                <>
                  <Field label="Reason (shown to client)">{(id) => <input id={id} className="input" value={draft.discount.reason} onChange={(e) => update((p) => ({ ...p, discount: { ...p.discount, reason: e.target.value } }))} placeholder="e.g. Referral discount" />}</Field>
                  <div className="sm:col-span-2">
                    <Checkbox checked={draft.discount.approved} onChange={(v) => update((p) => ({ ...p, discount: { ...p.discount, approved: v } }))} label="This discount is approved" hint="Unapproved discounts are not applied to any total or document." />
                  </div>
                  {draft.discount.approved && <Field label="Approved by">{(id) => <input id={id} className="input" value={draft.discount.approvedBy} onChange={(e) => update((p) => ({ ...p, discount: { ...p.discount, approvedBy: e.target.value } }))} placeholder="e.g. Merlin" />}</Field>}
                </>
              )}
            </div>
            {totals && totals.pendingDiscount > 0 && (
              <div className="mt-4">
                <Notice>A discount of {formatNaira(totals.pendingDiscount)} is entered but not approved, so it is not applied.</Notice>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------ dates */}
          <Card title="Documents, dates and status">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Quotation number" hint={draft.quoteNumber ? undefined : 'Assigned automatically when you save'}>
                {(id) => <input id={id} className="input tnum" value={draft.quoteNumber} onChange={(e) => set('quoteNumber', e.target.value.trim())} placeholder="Auto" />}
              </Field>
              <Field label="Invoice number" hint={draft.invoiceNumber ? undefined : 'Assigned automatically when you save'}>
                {(id) => <input id={id} className="input tnum" value={draft.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value.trim())} placeholder="Auto" />}
              </Field>
              <Field label="Project status">
                {(id) => (
                  <select id={id} className="input" value={draft.projectStatus} onChange={(e) => set('projectStatus', e.target.value as ProjectStatus)}>
                    {STATUSES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Date issued">{(id) => <input id={id} type="date" className="input" value={draft.issuedDate} onChange={(e) => update((p) => ({ ...p, issuedDate: e.target.value, quoteValidUntil: p.quoteValidUntil || addDays(e.target.value, s.quoteValidityDays) }))} />}</Field>
              <Field label="Quotation valid until">{(id) => <input id={id} type="date" className="input" value={draft.quoteValidUntil} onChange={(e) => set('quoteValidUntil', e.target.value)} />}</Field>
              <Field label="Payment due date">{(id) => <input id={id} type="date" className="input" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}</Field>
              <Field label="Project start date">{(id) => <input id={id} type="date" className="input" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
              <Field label="Expected completion">{(id) => <input id={id} type="date" className="input" value={draft.expectedCompletion} onChange={(e) => set('expectedCompletion', e.target.value)} />}</Field>
              <Field label="Payment status" hint="Worked out from verified payments — record payments under Receipts.">
                {() => <div className="flex h-[38px] items-center">{pay && <Badge tone={paymentTone(pay.status)}>{pay.status}</Badge>}</div>}
              </Field>
            </div>
          </Card>

          {/* ------------------------------------------------ maintenance */}
          <Card title="Monthly maintenance (optional)" subtitle="Tracked separately from the one-time project fee and not part of developer commission">
            <Checkbox checked={draft.maintenance.enabled} onChange={(v) => update((p) => ({ ...p, maintenance: { ...p.maintenance, enabled: v } }))} label="Offer ongoing maintenance for this project" />
            {draft.maintenance.enabled && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Fee per billing period">{(id) => <MoneyInput id={id} value={draft.maintenance.feeKobo} onChange={(v) => update((p) => ({ ...p, maintenance: { ...p.maintenance, feeKobo: v ?? 0 } }))} />}</Field>
                <Field label="Billing frequency">
                  {(id) => (
                    <select id={id} className="input" value={draft.maintenance.frequency} onChange={(e) => update((p) => ({ ...p, maintenance: { ...p.maintenance, frequency: e.target.value as MaintenanceFrequency } }))}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annually">Annually</option>
                    </select>
                  )}
                </Field>
                <Field label="Billing start date">{(id) => <input id={id} type="date" className="input" value={draft.maintenance.startDate} onChange={(e) => update((p) => ({ ...p, maintenance: { ...p.maintenance, startDate: e.target.value } }))} />}</Field>
                <Field label="What maintenance covers" className="sm:col-span-3">{(id) => <textarea id={id} rows={2} className="input" value={draft.maintenance.description} onChange={(e) => update((p) => ({ ...p, maintenance: { ...p.maintenance, description: e.target.value } }))} />}</Field>
                <div className="sm:col-span-3">
                  <Checkbox checked={draft.maintenance.showOnQuote} onChange={(v) => update((p) => ({ ...p, maintenance: { ...p.maintenance, showOnQuote: v } }))} label="Show as an optional extra on the quotation" />
                </div>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------ notes */}
          <Card title="Scope, terms and notes">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project scope and assumptions (one per line)">{(id) => <textarea id={id} rows={5} className="input" value={draft.scope} onChange={(e) => set('scope', e.target.value)} />}</Field>
              <Field label="Terms and conditions (one per line)">{(id) => <textarea id={id} rows={5} className="input" value={draft.terms} onChange={(e) => set('terms', e.target.value)} />}</Field>
              <Field label="Client-facing notes" hint="Printed on the quotation and invoice">{(id) => <textarea id={id} rows={3} className="input" value={draft.clientNotes} onChange={(e) => set('clientNotes', e.target.value)} />}</Field>
              <Field label="Internal notes" hint="Only on the confidential revenue report — never on client documents">{(id) => <textarea id={id} rows={3} className="input" value={draft.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />}</Field>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------ live summary */}
        <aside className="min-w-0">
          <div className="space-y-4 xl:sticky xl:top-6">
            <Card title="Live price summary" subtitle="Updates as you type">
              {totals ? (
                <div className="space-y-4">
                  <dl className="tnum space-y-1.5 text-sm">
                    <Row k={`${draft.packageName} package`} v={formatNaira(totals.base)} />
                    {draft.lineItems.map((l) => (
                      <Row key={l.id} k={`${l.name || 'Custom service'}${l.qty > 1 ? ` × ${l.qty}` : ''}`} v={formatNaira(l.unitPriceKobo * l.qty)} muted />
                    ))}
                    <div className="border-t border-line pt-1.5">
                      <Row k="Subtotal" v={formatNaira(totals.subtotal)} />
                    </div>
                    {totals.discount > 0 && <Row k={`Discount${draft.discount.type === 'percent' ? ` (${bpsToPercentText(draft.discount.bps)})` : ''}`} v={`−${formatNaira(totals.discount)}`} />}
                  </dl>
                  <div className="rounded-2xl bg-espresso px-4 py-3.5 text-cream">
                    <p className="text-[11px] uppercase tracking-wider text-cream/70">Total project fee</p>
                    <p className="tnum text-[28px] font-semibold leading-tight">{formatNaira(totals.total)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-2xl bg-ochre-soft/70 p-3">
                      <p className="text-[11px] text-ochre-dark">Deposit ({bpsToPercentText(draft.depositBps)})</p>
                      <p className="tnum font-semibold">{formatNaira(totals.deposit)}</p>
                    </div>
                    <div className="rounded-2xl bg-cream-2 p-3">
                      <p className="text-[11px] text-muted">On delivery</p>
                      <p className="tnum font-semibold">{formatNaira(totals.delivery)}</p>
                    </div>
                  </div>
                  {pay && pay.verified > 0 && (
                    <dl className="tnum space-y-1 text-sm">
                      <Row k="Received (verified)" v={formatNaira(pay.verified)} />
                      <Row k="Outstanding" v={formatNaira(pay.outstanding)} />
                    </dl>
                  )}
                </div>
              ) : (
                <p className="text-sm text-red-600">Fix the errors to see totals.</p>
              )}
            </Card>

            {dist && (
              <Card title="Revenue split" subtitle="Internal only — never shown on client documents">
                <div className="mb-3 flex h-2.5 overflow-hidden rounded-full">
                  {dist.shares.map((sh, i) => (
                    <div key={sh.id} style={{ width: `${sh.bps / 100}%` }} className={sh.isAgency ? 'bg-ochre' : i === 0 ? 'bg-espresso' : 'bg-muted'} />
                  ))}
                </div>
                <dl className="tnum space-y-1.5 text-sm">
                  {dist.shares.map((sh) => (
                    <Row key={sh.id} k={`${sh.name} · ${bpsToPercentText(sh.bps)}`} v={formatNaira(sh.amount)} />
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted">{dist.reconciles ? '✓ Adds up to exactly the project total.' : '⚠ Does not reconcile.'} The agency share is a gross allocation before expenses, not profit.</p>
                {splitDiffers && (
                  <div className="mt-3">
                    <Notice>
                      This project keeps the split it was created with. Settings now say {s.split.map((x) => `${x.name} ${bpsToPercentText(x.bps)}`).join(', ')}.{' '}
                      <button className="font-medium underline" onClick={() => set('split', s.split.map((x) => ({ ...x })))}>
                        Apply current split
                      </button>
                    </Notice>
                  </div>
                )}
              </Card>
            )}

            {draft.maintenance.enabled && draft.maintenance.feeKobo > 0 && (
              <Card title="Maintenance">
                <dl className="tnum space-y-1.5 text-sm">
                  <Row k="Monthly recurring" v={formatNaira(maintenanceSummary(draft.maintenance).monthly)} />
                  <Row k="Annual estimate" v={formatNaira(maintenanceSummary(draft.maintenance).annual)} />
                </dl>
              </Card>
            )}

            <div className="no-print sticky bottom-3 z-10 space-y-2 rounded-3xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur xl:static xl:shadow-none">
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" disabled={saving} onClick={() => void save()}>
                  {existing ? 'Save changes' : 'Save project'}
                </Button>
                <Button variant="dark" disabled={saving} onClick={() => void save(true)}>
                  Save & view quote
                </Button>
              </div>
              {existing && !dirty && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => docs.quotation(draft, 'download')}>
                    Quotation PDF
                  </Button>
                  <Button size="sm" onClick={() => go(`invoices?p=${draft.id}`)}>
                    Invoices
                  </Button>
                  <Button size="sm" onClick={() => go(`receipts?p=${draft.id}`)}>
                    Payments
                  </Button>
                  <Button size="sm" onClick={() => docs.revenue(draft)}>
                    Revenue report
                  </Button>
                </div>
              )}
              {dirty && <p className="px-1 text-xs text-amber-700">Unsaved changes</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3', muted && 'text-muted')}>
      <dt className="min-w-0 truncate">{k}</dt>
      <dd className="shrink-0 font-medium">{v}</dd>
    </div>
  );
}
