import { useEffect, useState } from 'react';
import { DocButtons, useDocs } from '../components/doc-actions';
import { ProjectPicker, usePicked } from '../components/shared';
import { Badge, Button, Card, ConfirmModal, Empty, Field, MoneyInput, Notice, PageHeader, Stat, TableWrap, paymentTone, td, th } from '../components/ui';
import { addDays, clientDisplayName, computeTotals, formatDate, invoiceDue, paymentSummary, todayISO } from '../lib/calc';
import { bpsToPercentText, formatNaira } from '../lib/money';
import { go, type Route } from '../lib/router';
import { useStore } from '../lib/store';
import type { InvoiceRecord, Project } from '../lib/types';

type Kind = 'deposit' | 'balance' | 'outstanding' | 'custom';

export function Invoices({ route }: { route: Route }) {
  const { data } = useStore();
  const p = usePicked(route);
  const docs = useDocs();
  const today = todayISO();

  const all = data.projects
    .flatMap((proj) => proj.invoices.map((inv) => ({ proj, inv, ...invoiceDue(proj, inv) })))
    .sort((a, b) => b.inv.issuedDate.localeCompare(a.inv.issuedDate));

  return (
    <div>
      <PageHeader eyebrow="Client documents" title="Invoices" />
      {!p ? (
        <Empty title="No projects yet">
          <Button variant="primary" onClick={() => go('calculator')}>
            Create a project
          </Button>
        </Empty>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <ProjectPicker view="invoices" value={p} />
            <Button size="sm" onClick={() => go(`calculator/${p.id}`)}>
              Edit project
            </Button>
          </div>
          <ProjectInvoices key={p.id} p={p} />
        </div>
      )}

      <Card title="All invoices" className="mt-6">
        {all.length === 0 ? (
          <Empty title="No invoices issued yet" />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Client</th>
                  <th className={th}>For</th>
                  <th className={`${th} text-right`}>Invoiced</th>
                  <th className={`${th} text-right`}>Still due</th>
                  <th className={th}>Due date</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {all.map(({ proj, inv, due }) => (
                  <tr key={proj.id + inv.number}>
                    <td className={`${td} tnum font-medium`}>{inv.number}</td>
                    <td className={td}>
                      <button className="text-left hover:underline" onClick={() => go(`invoices?p=${proj.id}`)}>
                        {clientDisplayName(proj)}
                      </button>
                    </td>
                    <td className={td}>{inv.label}</td>
                    <td className={`${td} tnum text-right`}>{formatNaira(inv.amountKobo)}</td>
                    <td className={`${td} tnum text-right font-semibold`}>{formatNaira(due)}</td>
                    <td className={td}>
                      {formatDate(inv.dueDate)} {due > 0 && inv.dueDate < today && <Badge tone="red">Overdue</Badge>}
                      {due === 0 && <Badge tone="green">Paid</Badge>}
                    </td>
                    <td className={td}>
                      <DocButtons compact onRun={(m) => docs.invoice(proj, inv, m)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function ProjectInvoices({ p }: { p: Project }) {
  const { data, upsertProject, takeNumber, toast } = useStore();
  const docs = useDocs();
  const t = computeTotals(p);
  const ps = paymentSummary(p, t);
  const today = todayISO();
  const hasDepositInv = p.invoices.some((i) => /deposit/i.test(i.label));
  const [kind, setKind] = useState<Kind>(hasDepositInv ? 'balance' : 'deposit');
  const [custom, setCustom] = useState<number>(0);
  const [customLabel, setCustomLabel] = useState('Installment');
  const [issued, setIssued] = useState(today);
  const [due, setDue] = useState(addDays(today, data.settings.paymentTermsDays));
  const [del, setDel] = useState<InvoiceRecord | null>(null);
  useEffect(() => setDue(addDays(issued, data.settings.paymentTermsDays)), [issued, data.settings.paymentTermsDays]);

  const depositLeft = Math.max(t.deposit - ps.verified, 0);
  const amounts: Record<Kind, number> = {
    deposit: depositLeft,
    balance: Math.min(t.delivery, ps.outstanding),
    outstanding: ps.outstanding,
    custom,
  };
  const labels: Record<Kind, string> = {
    deposit: `Deposit (${bpsToPercentText(p.depositBps)})`,
    balance: 'Delivery balance',
    outstanding: 'Full outstanding balance',
    custom: customLabel.trim() || 'Installment',
  };
  const amount = amounts[kind];
  const err = amount <= 0 ? 'Nothing is owed for this option.' : amount > ps.outstanding ? `More than the outstanding balance (${formatNaira(ps.outstanding)}).` : !due ? 'Pick a due date.' : due < issued ? 'Due date is before the issue date.' : null;

  const [creating, setCreating] = useState(false);
  async function create() {
    if (err) return toast(err, 'err');
    const firstUnused = !data.projects.some((x) => x.invoices.some((i) => i.number === p.invoiceNumber));
    let number: string;
    setCreating(true);
    try {
      number = p.invoiceNumber && firstUnused ? p.invoiceNumber : await takeNumber('invoice');
    } catch (e) {
      setCreating(false);
      return toast(`Could not get an invoice number: ${(e as Error).message}`, 'err');
    }
    setCreating(false);
    const inv: InvoiceRecord = { number, issuedDate: issued, dueDate: due, label: labels[kind], amountKobo: amount };
    upsertProject({ ...p, invoices: [...p.invoices, inv] });
    toast(`Invoice ${number} created`);
    docs.invoice({ ...p, invoices: [...p.invoices, inv] }, inv);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total agreed project cost" value={formatNaira(t.total)} tone="dark" />
        <Stat label="Received (verified)" value={formatNaira(ps.verified)} sub={ps.pending ? `${formatNaira(ps.pending)} pending verification` : undefined} />
        <Stat label="Outstanding balance" value={formatNaira(ps.outstanding)} tone={ps.outstanding ? 'accent' : 'default'} />
        <Stat label="Payment status" value={<Badge tone={paymentTone(ps.status)}>{ps.status}</Badge>} sub={`Deposit ${formatNaira(t.deposit)} · Delivery ${formatNaira(t.delivery)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={`Invoices for ${clientDisplayName(p)}`} subtitle={p.title}>
          {p.invoices.length === 0 ? (
            <Empty title="No invoice yet">Create the deposit invoice on the right.</Empty>
          ) : (
            <div className="space-y-3">
              {p.invoices.map((inv) => {
                const d = invoiceDue(p, inv);
                return (
                  <div key={inv.number} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
                    <div>
                      <p className="tnum font-semibold">
                        {inv.number} <span className="font-normal text-muted">· {inv.label}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Issued {formatDate(inv.issuedDate)} · Due {formatDate(inv.dueDate)}
                      </p>
                      <p className="tnum mt-1 text-sm">
                        Invoiced <b>{formatNaira(inv.amountKobo)}</b> · Paid against it {formatNaira(d.paidOnInvoice)} · Still due <b>{formatNaira(d.due)}</b>{' '}
                        {d.due === 0 ? <Badge tone="green">Paid</Badge> : inv.dueDate < today ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Open</Badge>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DocButtons compact onRun={(m) => docs.invoice(p, inv, m)} />
                      <Button size="sm" variant="danger" disabled={p.payments.some((x) => x.invoiceNumber === inv.number)} title="Only invoices with no payments recorded against them can be deleted" onClick={() => setDel(inv)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Create an invoice" subtitle="An invoice requests one installment — it does not mean money was received">
          <div className="space-y-3">
            {(['deposit', 'balance', 'outstanding', 'custom'] as Kind[]).map((k) => (
              <label key={k} className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm has-[:checked]:border-ochre has-[:checked]:bg-ochre-soft/50">
                <span className="flex items-center gap-2">
                  <input type="radio" name="kind" className="accent-[#C2693A]" checked={kind === k} onChange={() => setKind(k)} />
                  {k === 'custom' ? 'Custom amount' : labels[k]}
                </span>
                {k !== 'custom' && <span className="tnum font-medium">{formatNaira(amounts[k])}</span>}
              </label>
            ))}
            {kind === 'custom' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Label">{(id) => <input id={id} className="input" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />}</Field>
                <Field label="Amount">{(id) => <MoneyInput id={id} value={custom} onChange={(v) => setCustom(v ?? 0)} />}</Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue date">{(id) => <input id={id} type="date" className="input" value={issued} onChange={(e) => setIssued(e.target.value)} />}</Field>
              <Field label="Due date">{(id) => <input id={id} type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
            </div>
            {err && amount !== 0 && <Notice tone="red">{err}</Notice>}
            {amount === 0 && <p className="text-xs text-muted">{ps.outstanding === 0 ? 'This project is fully paid.' : 'Nothing is owed for this option.'}</p>}
            <Button variant="primary" className="w-full" disabled={!!err || creating} onClick={() => void create()}>
              Create invoice for {formatNaira(Math.max(amount, 0))}
            </Button>
          </div>
        </Card>
      </div>
      <ConfirmModal
        open={!!del}
        title="Delete invoice?"
        danger
        confirmLabel="Delete invoice"
        message={`Invoice ${del?.number} will be removed. Its number will not be reused.`}
        onClose={() => setDel(null)}
        onConfirm={() => {
          if (!del) return;
          upsertProject({ ...p, invoices: p.invoices.filter((i) => i.number !== del.number) });
          toast('Invoice deleted');
        }}
      />
    </>
  );
}
