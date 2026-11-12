import { useState } from 'react';
import { DocButtons, useDocs } from '../components/doc-actions';
import { ProjectPicker, usePicked } from '../components/shared';
import { Badge, Button, Card, Checkbox, ConfirmModal, Empty, Field, MoneyInput, Notice, PageHeader, Stat, TableWrap, paymentTone, td, th } from '../components/ui';
import { clientDisplayName, computeTotals, formatDate, invoiceDue, paymentSummary, todayISO, uid, validatePayment } from '../lib/calc';
import { formatNaira } from '../lib/money';
import { go, type Route } from '../lib/router';
import { useStore } from '../lib/store';
import type { ClientPayment, PaymentMethod, Project } from '../lib/types';

const METHODS: PaymentMethod[] = ['Bank transfer', 'Cash', 'POS / Card', 'Paystack', 'Flutterwave', 'Cheque', 'Other'];

export function Receipts({ route }: { route: Route }) {
  const { data } = useStore();
  const p = usePicked(route);
  const docs = useDocs();
  const issued = data.projects
    .flatMap((proj) => proj.payments.filter((x) => x.receiptNumber).map((pay) => ({ proj, pay })))
    .sort((a, b) => (b.pay.receiptNumber ?? '').localeCompare(a.pay.receiptNumber ?? ''));

  return (
    <div>
      <PageHeader eyebrow="Client documents" title="Payments & receipts" />
      {!p ? (
        <Empty title="No projects yet" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <ProjectPicker view="receipts" value={p} />
            <Button size="sm" onClick={() => go(`invoices?p=${p.id}`)}>
              Invoices
            </Button>
          </div>
          <ProjectPayments key={p.id} p={p} />
        </div>
      )}
      <Card title="Receipts issued" subtitle="Each verified payment gets one receipt number, issued once" className="mt-6">
        {issued.length === 0 ? (
          <Empty title="No receipts issued yet" />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className={th}>Receipt</th>
                  <th className={th}>Client</th>
                  <th className={th}>Payment date</th>
                  <th className={th}>Method</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {issued.map(({ proj, pay }) => (
                  <tr key={pay.id}>
                    <td className={`${td} tnum font-medium`}>{pay.receiptNumber}</td>
                    <td className={td}>{clientDisplayName(proj)}</td>
                    <td className={td}>{formatDate(pay.date)}</td>
                    <td className={td}>{pay.method}</td>
                    <td className={`${td} tnum text-right font-semibold`}>{formatNaira(pay.amountKobo)}</td>
                    <td className={td}>
                      <DocButtons compact onRun={(m) => docs.receipt(proj, pay, m)} />
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

function emptyPayment(p: Project): ClientPayment {
  const open = p.invoices.find((i) => invoiceDue(p, i).due > 0);
  return { id: uid('pay_'), amountKobo: open ? invoiceDue(p, open).due : 0, date: todayISO(), method: 'Bank transfer', reference: '', note: '', status: 'pending', verifiedAt: null, receiptNumber: null, receiptIssuedAt: null, isOverpayment: false, invoiceNumber: open?.number ?? p.invoiceNumber };
}

function ProjectPayments({ p }: { p: Project }) {
  const { upsertProject, toast } = useStore();
  const docs = useDocs();
  const t = computeTotals(p);
  const ps = paymentSummary(p, t);
  const [form, setForm] = useState<ClientPayment>(() => emptyPayment(p));
  const [verifyNow, setVerifyNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<ClientPayment | null>(null);
  const [verify, setVerify] = useState<ClientPayment | null>(null);

  function record() {
    const e = validatePayment(p, form);
    setError(e);
    if (e) return;
    const pay: ClientPayment = { ...form, status: verifyNow ? 'verified' : 'pending', verifiedAt: verifyNow ? new Date().toISOString() : null };
    upsertProject({ ...p, payments: [...p.payments, pay] });
    toast(verifyNow ? 'Payment recorded and verified' : 'Payment recorded as pending — verify it once it shows in your account');
    setForm(emptyPayment({ ...p, payments: [...p.payments, pay] }));
    setVerifyNow(false);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total project value" value={formatNaira(t.total)} tone="dark" />
        <Stat label="Received (verified)" value={formatNaira(ps.verified)} />
        <Stat label="Pending verification" value={formatNaira(ps.pending)} tone={ps.pending ? 'warn' : 'default'} sub="Not counted as received" />
        <Stat label="Outstanding" value={formatNaira(ps.outstanding)} sub={<Badge tone={paymentTone(ps.status)}>{ps.status}</Badge>} tone={ps.outstanding ? 'accent' : 'default'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={`Payments from ${clientDisplayName(p)}`} subtitle="A receipt can only be generated after a payment is verified">
          {p.payments.length === 0 ? (
            <Empty title="No payments recorded" />
          ) : (
            <div className="space-y-3">
              {p.payments.map((pay) => (
                <div key={pay.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
                  <div className="min-w-0">
                    <p className="tnum font-semibold">
                      {formatNaira(pay.amountKobo)}{' '}
                      {pay.status === 'verified' ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending — not yet confirmed</Badge>} {pay.isOverpayment && <Badge tone="red">Overpayment</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDate(pay.date)} · {pay.method}
                      {pay.reference && ` · Ref ${pay.reference}`} · Invoice {pay.invoiceNumber || '—'}
                      {pay.receiptNumber && ` · Receipt ${pay.receiptNumber}`}
                    </p>
                    {pay.note && <p className="mt-1 text-xs text-espresso">{pay.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pay.status === 'pending' ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setVerify(pay)}>
                          Mark received & verified
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDel(pay)}>
                          Delete
                        </Button>
                      </>
                    ) : (
                      <>
                        {!pay.receiptNumber && <span className="text-xs text-muted">No receipt yet →</span>}
                        <DocButtons compact label={pay.receiptNumber ? 'Receipt' : undefined} onRun={(m) => docs.receipt(p, pay, m)} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Record a payment" subtitle="Only record money the client says they sent">
          <div className="space-y-3">
            <Field label="Amount">{(id) => <MoneyInput id={id} value={form.amountKobo} onChange={(v) => setForm({ ...form, amountKobo: v ?? 0 })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment date">{(id) => <input id={id} type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
              <Field label="Method">
                {(id) => (
                  <select id={id} className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
                    {METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Transaction reference">{(id) => <input id={id} className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Bank / POS / Paystack reference" />}</Field>
            <Field label="For invoice">
              {(id) => (
                <select id={id} className="input" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}>
                  {p.invoices.map((i) => (
                    <option key={i.number} value={i.number}>
                      {i.number} — {i.label}
                    </option>
                  ))}
                  {!p.invoices.some((i) => i.number === p.invoiceNumber) && <option value={p.invoiceNumber}>{p.invoiceNumber || 'No invoice'}</option>}
                </select>
              )}
            </Field>
            <Field label="Note (optional)">{(id) => <input id={id} className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}</Field>
            <Checkbox checked={form.isOverpayment} onChange={(v) => setForm({ ...form, isOverpayment: v })} label="Record as overpayment" hint="Only if the client really paid more than they owe. A note is required." />
            <Checkbox checked={verifyNow} onChange={setVerifyNow} label="I have confirmed this money is in our account" hint="Leave unticked if you haven't checked yet — it will be saved as pending." />
            {error && <Notice tone="red">{error}</Notice>}
            <Button variant="primary" className="w-full" onClick={record}>
              Record payment
            </Button>
            <p className="text-xs text-muted">Still owed after other recorded payments: {formatNaira(Math.max(t.total - p.payments.reduce((s, x) => s + x.amountKobo, 0), 0))}</p>
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={!!verify}
        title="Confirm payment received?"
        confirmLabel="Yes, it's in our account"
        message={
          <>
            Only confirm if you can see <b>{verify && formatNaira(verify.amountKobo)}</b> {verify?.reference && <>with reference <b>{verify.reference}</b></>} in the agency account. After this you can issue a receipt.
          </>
        }
        onClose={() => setVerify(null)}
        onConfirm={() => {
          if (!verify) return;
          upsertProject({ ...p, payments: p.payments.map((x) => (x.id === verify.id ? { ...x, status: 'verified', verifiedAt: new Date().toISOString() } : x)) });
          toast('Payment verified');
        }}
      />
      <ConfirmModal
        open={!!del}
        title="Delete pending payment?"
        danger
        confirmLabel="Delete"
        message={`The pending payment of ${del ? formatNaira(del.amountKobo) : ''} will be removed.`}
        onClose={() => setDel(null)}
        onConfirm={() => {
          if (!del) return;
          upsertProject({ ...p, payments: p.payments.filter((x) => x.id !== del.id) });
          toast('Payment deleted');
        }}
      />
    </>
  );
}
