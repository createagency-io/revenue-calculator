import { useState } from 'react';
import { useDocs } from '../components/doc-actions';
import { ProjectPicker, usePicked } from '../components/shared';
import { Badge, Button, Card, ConfirmModal, Empty, Field, MoneyInput, Notice, PageHeader, Stat, TableWrap, cx, td, th } from '../components/ui';
import { clientDisplayName, distribution, formatDate, maintenanceSummary, todayISO, uid } from '../lib/calc';
import { bpsToPercentText, formatNaira } from '../lib/money';
import type { Route } from '../lib/router';
import { useStore } from '../lib/store';
import type { Project } from '../lib/types';

export function Distribution({ route }: { route: Route }) {
  const { data } = useStore();
  const p = usePicked(route);

  // Totals by person across every project (people matched by id).
  const people = new Map<string, { name: string; role: string; alloc: number; paid: number; earned: number }>();
  for (const proj of data.projects) {
    if (proj.projectStatus === 'Cancelled') continue;
    for (const s of distribution(proj).shares) {
      const cur = people.get(s.id) ?? { name: s.name, role: s.role, alloc: 0, paid: 0, earned: 0 };
      cur.alloc += s.amount;
      cur.paid += s.paid;
      cur.earned += s.earnedOnCash;
      people.set(s.id, cur);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Internal — confidential" title="Revenue distribution" />
      <div className="mb-6">
        <Notice tone="red">
          <b>Internal only.</b> Commission figures never appear on quotations, invoices or receipts. Don’t share this screen or its PDF with clients.
        </Notice>
      </div>
      {!p ? (
        <Empty title="No projects yet" />
      ) : (
        <div className="space-y-6">
          <ProjectPicker view="distribution" value={p} />
          <ProjectDistribution key={p.id} p={p} />
        </div>
      )}

      <Card title="All projects — totals by person" subtitle="Excludes cancelled projects" className="mt-6">
        <TableWrap>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className={th}>Person</th>
                <th className={`${th} text-right`}>Total allocation</th>
                <th className={`${th} text-right`}>Earned on cash collected</th>
                <th className={`${th} text-right`}>Paid out</th>
                <th className={`${th} text-right`}>Unpaid balance</th>
              </tr>
            </thead>
            <tbody>
              {[...people.entries()].map(([id, v]) => {
                const agency = id === 'agency' || v.role === 'Agency';
                return (
                  <tr key={id}>
                    <td className={td}>
                      <p className="font-medium">{v.name}</p>
                      <p className="text-xs text-muted">{v.role}</p>
                    </td>
                    <td className={`${td} tnum text-right font-semibold`}>{formatNaira(v.alloc)}</td>
                    <td className={`${td} tnum text-right`}>{formatNaira(v.earned)}</td>
                    <td className={`${td} tnum text-right`}>{agency ? '—' : formatNaira(v.paid)}</td>
                    <td className={`${td} tnum text-right`}>{agency ? '—' : formatNaira(v.alloc - v.paid)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

function ProjectDistribution({ p }: { p: Project }) {
  const { upsertProject, toast } = useStore();
  const docs = useDocs();
  const d = distribution(p);
  const m = maintenanceSummary(p.maintenance);
  const devs = d.shares.filter((s) => !s.isAgency);

  const [payTo, setPayTo] = useState(devs[0]?.id ?? '');
  const [payAmt, setPayAmt] = useState(0);
  const [payDate, setPayDate] = useState(todayISO());
  const [payMethod, setPayMethod] = useState('Bank transfer');
  const [payNote, setPayNote] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState(0);
  const [expDate, setExpDate] = useState(todayISO());
  const [confirm, setConfirm] = useState<{ kind: 'payout' | 'expense'; id: string } | null>(null);

  function addPayout() {
    const who = devs.find((x) => x.id === payTo);
    if (!who) return setPayErr('Choose who was paid.');
    if (payAmt <= 0) return setPayErr('Enter an amount greater than ₦0.');
    if (payAmt > who.unpaid) return setPayErr(`${who.name}'s unpaid allocation on this project is ${formatNaira(who.unpaid)}. You can’t pay out more than the allocation.`);
    if (!payDate) return setPayErr('Enter the date paid.');
    setPayErr(null);
    upsertProject({ ...p, commissionPayouts: [...p.commissionPayouts, { id: uid('cp_'), participantId: who.id, amountKobo: payAmt, date: payDate, method: payMethod, note: payNote }] });
    toast(`Recorded ${formatNaira(payAmt)} paid to ${who.name}`);
    setPayAmt(0);
    setPayNote('');
  }

  function addExpense() {
    if (!expDesc.trim() || expAmt <= 0) return toast('Enter a description and an amount above ₦0.', 'err');
    upsertProject({ ...p, expenses: [...p.expenses, { id: uid('ex_'), description: expDesc.trim(), amountKobo: expAmt, date: expDate }] });
    setExpDesc('');
    setExpAmt(0);
    toast('Expense recorded');
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-white p-4">
        <div>
          <p className="font-semibold">{clientDisplayName(p)} — {p.title}</p>
          <p className="text-xs text-muted">
            {p.quoteNumber} · {p.packageName} · {p.projectStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="dark" onClick={() => docs.revenue(p, 'download')}>
            Download Full Revenue Breakdown PDF
          </Button>
          <Button onClick={() => docs.revenue(p, 'print')}>Print Full Revenue Breakdown</Button>
          <Button onClick={() => docs.revenue(p, 'preview')}>Preview</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Contracted revenue" value={formatNaira(d.totals.total)} tone="dark" />
        <Stat label="Cash collected (verified)" value={formatNaira(d.payments.verified)} sub={`Outstanding ${formatNaira(d.payments.outstanding)}`} />
        <Stat label="Agency gross allocation" value={formatNaira(d.agencyAllocation)} sub="Before expenses — not profit" tone="accent" />
        <Stat label="Agency after expenses" value={formatNaira(d.agencyAfterExpenses)} sub={`Expenses ${formatNaira(d.expenses)}`} tone={d.agencyAfterExpenses < 0 ? 'warn' : 'default'} />
      </div>

      <Card title="Who gets what" subtitle="Allocation = share of the agreed project total. Earned on cash = share of money actually collected.">
        <div className="mb-5 flex h-9 overflow-hidden rounded-xl text-[10px] font-medium text-white sm:text-xs">
          {d.shares.map((s, i) => (
            <div key={s.id} style={{ width: `${s.bps / 100}%` }} className={cx('flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap px-1', s.isAgency ? 'bg-ochre' : i === 0 ? 'bg-espresso' : 'bg-muted')}>
              <span className="truncate">{s.name} {bpsToPercentText(s.bps)}</span>
            </div>
          ))}
        </div>
        <TableWrap>
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className={th}>Party</th>
                <th className={th}>Share</th>
                <th className={`${th} text-right`}>Allocation</th>
                <th className={`${th} text-right`}>Earned on cash</th>
                <th className={`${th} text-right`}>Paid</th>
                <th className={`${th} text-right`}>Unpaid balance</th>
                <th className={`${th} text-right`}>Due now</th>
              </tr>
            </thead>
            <tbody>
              {d.shares.map((s) => (
                <tr key={s.id}>
                  <td className={td}>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted">{s.role}</p>
                  </td>
                  <td className={td}>{bpsToPercentText(s.bps)}</td>
                  <td className={`${td} tnum text-right font-semibold`}>{formatNaira(s.amount)}</td>
                  <td className={`${td} tnum text-right`}>{formatNaira(s.earnedOnCash)}</td>
                  <td className={`${td} tnum text-right`}>{s.isAgency ? '—' : formatNaira(s.paid)}</td>
                  <td className={`${td} tnum text-right`}>{s.isAgency ? '—' : formatNaira(s.unpaid)}</td>
                  <td className={`${td} tnum text-right`}>{s.isAgency ? '—' : s.dueNow > 0 ? <Badge tone="amber">{formatNaira(s.dueNow)}</Badge> : '₦0.00'}</td>
                </tr>
              ))}
              <tr className="bg-cream-2/70 font-semibold">
                <td className={td}>Total</td>
                <td className={td}>100%</td>
                <td className={`${td} tnum text-right`}>{formatNaira(d.shares.reduce((a, s) => a + s.amount, 0))}</td>
                <td className={`${td} tnum text-right`}>{formatNaira(d.shares.reduce((a, s) => a + s.earnedOnCash, 0))}</td>
                <td className={`${td} tnum text-right`}>{formatNaira(d.developerPaid)}</td>
                <td className={`${td} tnum text-right`}>{formatNaira(d.developerAllocation - d.developerPaid)}</td>
                <td className={td}></td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-3 text-xs text-muted">
          {d.reconciles ? '✓ Allocations add up to exactly the project total.' : '⚠ Allocations do not reconcile.'} Rounding: developer shares are rounded down to the kobo; the agency gets the exact remainder.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Commission payments" subtitle="Record money actually paid to a developer">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paid to">
              {(id) => (
                <select id={id} className="input" value={payTo} onChange={(e) => setPayTo(e.target.value)}>
                  {devs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} (unpaid {formatNaira(x.unpaid)})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Amount">{(id) => <MoneyInput id={id} value={payAmt} onChange={(v) => setPayAmt(v ?? 0)} />}</Field>
            <Field label="Date paid">{(id) => <input id={id} type="date" className="input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />}</Field>
            <Field label="Method">{(id) => <input id={id} className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />}</Field>
            <Field label="Note" className="sm:col-span-2">{(id) => <input id={id} className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. Commission on deposit" />}</Field>
          </div>
          {payErr && <div className="mt-3"><Notice tone="red">{payErr}</Notice></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={addPayout}>Record commission payment</Button>
            {devs.find((x) => x.id === payTo)?.dueNow ? (
              <Button size="sm" onClick={() => setPayAmt(devs.find((x) => x.id === payTo)!.dueNow)}>
                Fill amount due now
              </Button>
            ) : null}
          </div>
          {p.commissionPayouts.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {p.commissionPayouts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <b>{p.split.find((s) => s.id === c.participantId)?.name}</b> · {formatDate(c.date)} {c.note && <span className="text-muted">· {c.note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-semibold">{formatNaira(c.amountKobo)}</span>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => setConfirm({ kind: 'payout', id: c.id })}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Project expenses" subtitle="Costs paid by the agency for this project (hosting, plugins, stock photos…)">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px]">
            <input className="input" placeholder="Description" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} aria-label="Expense description" />
            <MoneyInput value={expAmt} onChange={(v) => setExpAmt(v ?? 0)} />
            <input type="date" className="input" value={expDate} onChange={(e) => setExpDate(e.target.value)} aria-label="Expense date" />
          </div>
          <Button className="mt-3" variant="primary" onClick={addExpense}>
            Add expense
          </Button>
          {p.expenses.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {p.expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {e.description} <span className="text-muted">· {formatDate(e.date)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-semibold">{formatNaira(e.amountKobo)}</span>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => setConfirm({ kind: 'expense', id: e.id })}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {m.active && <MaintenanceCard p={p} />}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === 'payout' ? 'Remove commission payment?' : 'Remove expense?'}
        danger
        confirmLabel="Remove"
        message="This record will be deleted. Totals will update."
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'payout') upsertProject({ ...p, commissionPayouts: p.commissionPayouts.filter((c) => c.id !== confirm.id) });
          else upsertProject({ ...p, expenses: p.expenses.filter((e) => e.id !== confirm.id) });
        }}
      />
    </>
  );
}

function MaintenanceCard({ p }: { p: Project }) {
  const { upsertProject, toast } = useStore();
  const m = maintenanceSummary(p.maintenance);
  const [amt, setAmt] = useState(p.maintenance.feeKobo);
  const [date, setDate] = useState(todayISO());
  const [label, setLabel] = useState('');
  const [ref, setRef] = useState('');
  return (
    <Card title="Maintenance payments" subtitle="Separate from the project fee and from developer commission (set by a separate agreement)">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly recurring" value={formatNaira(m.monthly)} />
        <Stat label="Annual estimate" value={formatNaira(m.annual)} />
        <Stat label="Received" value={formatNaira(m.received)} sub={`${m.periodsBilled} period(s) billed: ${formatNaira(m.billedToDate)}`} />
        <Stat label="Outstanding" value={formatNaira(m.outstanding)} sub={m.status} tone={m.outstanding ? 'warn' : 'default'} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <MoneyInput value={amt} onChange={(v) => setAmt(v ?? 0)} />
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" />
        <input className="input" placeholder="Period, e.g. Nov 2026" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Period" />
        <input className="input" placeholder="Reference" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Reference" />
      </div>
      <Button
        className="mt-3"
        variant="primary"
        onClick={() => {
          if (amt <= 0 || !date) return toast('Enter an amount and date.', 'err');
          upsertProject({ ...p, maintenance: { ...p.maintenance, payments: [...p.maintenance.payments, { id: uid('mp_'), amountKobo: amt, date, periodLabel: label, method: 'Bank transfer', reference: ref }] } });
          setLabel('');
          setRef('');
          toast('Maintenance payment recorded');
        }}
      >
        Record maintenance payment
      </Button>
      {p.maintenance.payments.length > 0 && (
        <ul className="mt-4 divide-y divide-line text-sm">
          {p.maintenance.payments.map((x) => (
            <li key={x.id} className="flex justify-between gap-3 py-2">
              <span>
                {x.periodLabel || 'Payment'} <span className="text-muted">· {formatDate(x.date)}</span>
              </span>
              <span className="tnum font-semibold">{formatNaira(x.amountKobo)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
