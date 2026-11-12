import { useState } from 'react';
import { Badge, Button, Card, Empty, Notice, PageHeader, Stat, TableWrap, paymentTone, td, th } from '../components/ui';
import { clientDisplayName, distribution, formatDate, maintenanceSummary } from '../lib/calc';
import { formatNaira, formatNairaShort } from '../lib/money';
import { go } from '../lib/router';
import { useStore } from '../lib/store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Overview() {
  const { data, clearDemo, toast } = useStore();
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const inRange = (iso: string) => (!from || iso >= from) && (!to || iso <= to);
  const projects = data.projects.filter((p) => p.projectStatus !== 'Cancelled' && (!projectId || p.id === projectId) && inRange(p.issuedDate));
  const hasDemo = data.projects.some((p) => p.isDemo);

  const people = data.settings.split;
  const byPerson = new Map(people.map((s) => [s.id, { name: s.name, isAgency: s.isAgency, alloc: 0, paid: 0 }]));
  let contracted = 0;
  let received = 0;
  let outstanding = 0;
  let expenses = 0;
  let agencyAlloc = 0;
  let mrr = 0;
  let maintReceived = 0;
  const statusCount: Record<string, number> = {};
  for (const p of projects) {
    const d = distribution(p);
    contracted += d.totals.total;
    received += d.payments.verified;
    outstanding += d.payments.outstanding;
    expenses += d.expenses;
    agencyAlloc += d.agencyAllocation;
    statusCount[d.payments.status] = (statusCount[d.payments.status] ?? 0) + 1;
    for (const s of d.shares) {
      const cur = byPerson.get(s.id) ?? { name: s.name, isAgency: s.isAgency, alloc: 0, paid: 0 };
      cur.alloc += s.amount;
      cur.paid += s.paid;
      byPerson.set(s.id, cur);
    }
    const m = maintenanceSummary(p.maintenance);
    mrr += m.monthly;
    maintReceived += m.received;
  }
  const devs = [...byPerson.values()].filter((x) => !x.isAgency);

  // Monthly chart: last 6 months (ending at the "to" date or today)
  const end = to ? new Date(to) : new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth() - 5 + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()], contracted: 0, received: 0 };
  });
  for (const p of projects) {
    const d = distribution(p);
    const mk = months.find((m) => p.issuedDate.startsWith(m.key));
    if (mk) mk.contracted += d.totals.total;
    for (const pay of p.payments.filter((x) => x.status === 'verified')) {
      const mm = months.find((m) => pay.date.startsWith(m.key));
      if (mm) mm.received += pay.amountKobo;
    }
  }
  const max = Math.max(1, ...months.flatMap((m) => [m.contracted, m.received]));

  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  return (
    <div>
      <PageHeader eyebrow="C.R.E.A.T.E. Agency" title="Financial overview">
        <Button variant="primary" onClick={() => go('calculator')}>
          + New project
        </Button>
      </PageHeader>

      {hasDemo && (
        <div className="mb-5">
          <Notice tone="blue">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                You’re looking at <b>demo data</b> (fictional clients) so you can test everything. Clear it before entering real projects.
              </span>
              <Button size="sm" onClick={() => void clearDemo().then(() => toast('Demo projects removed')).catch((e: Error) => toast(e.message, 'err'))}>
                Clear demo data
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-3xl border border-line bg-white/70 p-4">
        <div>
          <label className="label" htmlFor="f-proj">
            Project
          </label>
          <select id="f-proj" className="input w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {clientDisplayName(p)} — {p.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">
            Issued from
          </label>
          <input id="f-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">
            Issued to
          </label>
          <input id="f-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(projectId || from || to) && (
          <Button size="sm" onClick={() => (setProjectId(''), setFrom(''), setTo(''))}>
            Clear filters
          </Button>
        )}
        <p className="ml-auto text-xs text-muted">{projects.length} project(s) · cancelled projects excluded</p>
      </div>

      {projects.length === 0 ? (
        <Empty title="No projects match">Create a project in the calculator to see figures here.</Empty>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total contracted revenue" value={formatNairaShort(contracted)} title={formatNaira(contracted)} tone="dark" sub="One-time project fees" />
            <Stat label="Client payments received" value={formatNairaShort(received)} title={formatNaira(received)} sub="Verified only" />
            <Stat label="Outstanding client balances" value={formatNairaShort(outstanding)} title={formatNaira(outstanding)} tone={outstanding ? 'accent' : 'default'} />
            <Stat label="Monthly maintenance revenue" value={formatNairaShort(mrr)} title={formatNaira(mrr)} sub={`Received to date ${formatNairaShort(maintReceived)}`} />
            {devs.map((d) => (
              <Stat key={d.name + 'a'} label={`${d.name}'s commission allocation`} value={formatNairaShort(d.alloc)} title={formatNaira(d.alloc)} />
            ))}
            {devs.map((d) => (
              <Stat key={d.name + 'p'} label={`${d.name}'s commissions paid`} value={formatNairaShort(d.paid)} title={formatNaira(d.paid)} sub={`Unpaid ${formatNairaShort(d.alloc - d.paid)}`} />
            ))}
            <Stat label="Agency gross allocation" value={formatNairaShort(agencyAlloc)} title={formatNaira(agencyAlloc)} sub="Before expenses — not profit" tone="accent" />
            <Stat label="Recorded business expenses" value={formatNairaShort(expenses)} title={formatNaira(expenses)} />
            <Stat label="Agency balance after expenses" value={formatNairaShort(agencyAlloc - expenses)} title={formatNaira(agencyAlloc - expenses)} tone={agencyAlloc - expenses < 0 ? 'warn' : 'default'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Contracted vs received" subtitle="Last 6 months · contracted by issue date, received by payment date">
              <div className="mb-3 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm bg-espresso" /> Contracted
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm bg-ochre" /> Received
                </span>
              </div>
              <div className="flex h-48 items-end gap-2 sm:gap-4">
                {months.map((m) => (
                  <div key={m.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div className="flex h-full w-full items-end justify-center gap-1">
                      <div className="w-1/2 max-w-6 rounded-t-md bg-espresso transition-all" style={{ height: `${(m.contracted / max) * 100}%` }} title={`Contracted ${formatNaira(m.contracted)}`} />
                      <div className="w-1/2 max-w-6 rounded-t-md bg-ochre transition-all" style={{ height: `${(m.received / max) * 100}%` }} title={`Received ${formatNaira(m.received)}`} />
                    </div>
                    <span className="text-[11px] text-muted">{m.label}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Where the money goes" subtitle="Allocation of contracted revenue">
              <div className="mb-4 flex h-3 overflow-hidden rounded-full">
                {[...byPerson.values()].map((v, i) => (
                  <div key={v.name} style={{ width: `${contracted ? (v.alloc / contracted) * 100 : 0}%` }} className={v.isAgency ? 'bg-ochre' : i === 0 ? 'bg-espresso' : 'bg-muted'} />
                ))}
              </div>
              <dl className="tnum space-y-2 text-sm">
                {[...byPerson.values()].map((v) => (
                  <div key={v.name} className="flex justify-between">
                    <dt>{v.name}</dt>
                    <dd className="font-semibold">{formatNaira(v.alloc)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
                {Object.entries(statusCount).map(([k, v]) => (
                  <Badge key={k} tone={paymentTone(k)}>
                    {v} {k.toLowerCase()}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Recently updated" actions={<Button size="sm" onClick={() => go('history')}>All projects</Button>}>
            <TableWrap>
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th className={th}>Client / project</th>
                    <th className={th}>Issued</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                    <th className={th}>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => {
                    const d = distribution(p);
                    return (
                      <tr key={p.id} className="cursor-pointer hover:bg-cream/60" onClick={() => go(`calculator/${p.id}`)}>
                        <td className={td}>
                          <p className="font-medium">{clientDisplayName(p)}</p>
                          <p className="text-xs text-muted">{p.title}</p>
                        </td>
                        <td className={td}>{formatDate(p.issuedDate)}</td>
                        <td className={`${td} tnum text-right font-semibold`}>{formatNaira(d.totals.total)}</td>
                        <td className={`${td} tnum text-right`}>{formatNaira(d.payments.outstanding)}</td>
                        <td className={td}>
                          <Badge tone={paymentTone(d.payments.status)}>{d.payments.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      )}
    </div>
  );
}
