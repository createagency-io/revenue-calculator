import { useRef, useState } from 'react';
import { useDocs } from '../components/doc-actions';
import { useDuplicate } from '../components/shared';
import { Badge, Button, Card, ConfirmModal, Empty, Notice, PageHeader, TableWrap, paymentTone, projectTone, td, th } from '../components/ui';
import { clientDisplayName, computeTotals, formatDate, paymentSummary, todayISO, type PaymentStatus } from '../lib/calc';
import { downloadText, projectsToCSV } from '../lib/csv';
import { formatNaira } from '../lib/money';
import { go } from '../lib/router';
import { exportAppData, importAppData } from '../lib/storage';
import { useStore } from '../lib/store';
import type { AppData, Project } from '../lib/types';

const PAY_STATUSES: PaymentStatus[] = ['Unpaid', 'Partially paid', 'Deposit paid', 'Fully paid', 'Overpaid'];

export function History() {
  const { data, deleteProject, toast } = useStore();
  const duplicate = useDuplicate();
  const docs = useDocs();
  const [q, setQ] = useState('');
  const [pkg, setPkg] = useState('');
  const [pay, setPay] = useState('');
  const [status, setStatus] = useState('');
  const [del, setDel] = useState<Project | null>(null);

  const rows = data.projects
    .map((p) => ({ p, t: computeTotals(p), ps: paymentSummary(p) }))
    .filter(({ p }) => `${p.client.fullName} ${p.client.business} ${p.quoteNumber} ${p.invoiceNumber} ${p.title}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter(({ p }) => !pkg || p.packageId === pkg)
    .filter(({ ps }) => !pay || ps.status === pay)
    .filter(({ p }) => !status || p.projectStatus === status)
    .sort((a, b) => b.p.issuedDate.localeCompare(a.p.issuedDate));

  return (
    <div>
      <PageHeader eyebrow="Records" title="Project history">
        <Button onClick={() => downloadText(`create-projects-${todayISO()}.csv`, projectsToCSV(rows.map((r) => r.p)), 'text/csv;charset=utf-8')}>Export CSV</Button>
        <BackupButtons />
      </PageHeader>
      <Card
        title={`${rows.length} of ${data.projects.length} projects`}
        actions={
          <div className="flex flex-wrap gap-2">
            <input className="input w-52" placeholder="Search client name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by client" />
            <select className="input w-40" value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Filter by package">
              <option value="">All packages</option>
              {data.settings.packages.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select className="input w-40" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Filter by payment status">
              <option value="">All payment statuses</option>
              {PAY_STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by project status">
              <option value="">All stages</option>
              {['Quotation', 'Approved', 'In progress', 'Delivered', 'Completed', 'On hold', 'Cancelled'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty title="No matching projects" />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <th className={th}>Quote / invoice</th>
                  <th className={th}>Client / project</th>
                  <th className={th}>Package</th>
                  <th className={th}>Issued</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Received</th>
                  <th className={`${th} text-right`}>Outstanding</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, t, ps }) => (
                  <tr key={p.id} className="hover:bg-cream/60">
                    <td className={`${td} tnum`}>
                      <p className="font-medium">{p.quoteNumber}</p>
                      <p className="text-xs text-muted">{p.invoiceNumber}</p>
                    </td>
                    <td className={td}>
                      <p className="font-medium">
                        {clientDisplayName(p)} {p.isDemo && <Badge tone="blue">Demo</Badge>}
                      </p>
                      <p className="text-xs text-muted">{p.title}</p>
                    </td>
                    <td className={td}>{p.packageName}</td>
                    <td className={td}>{formatDate(p.issuedDate)}</td>
                    <td className={`${td} tnum text-right font-semibold`}>{formatNaira(t.total)}</td>
                    <td className={`${td} tnum text-right`}>{formatNaira(ps.verified)}</td>
                    <td className={`${td} tnum text-right`}>{formatNaira(ps.outstanding)}</td>
                    <td className={td}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={projectTone(p.projectStatus)}>{p.projectStatus}</Badge>
                        <Badge tone={paymentTone(ps.status)}>{ps.status}</Badge>
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex max-w-[260px] flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => go(`calculator/${p.id}`)}>
                          Edit
                        </Button>
                        <Button size="sm" onClick={() => docs.quotation(p)}>
                          Quote
                        </Button>
                        <Button size="sm" onClick={() => go(`invoices?p=${p.id}`)}>
                          Invoices
                        </Button>
                        <Button size="sm" onClick={() => go(`receipts?p=${p.id}`)}>
                          Receipts
                        </Button>
                        <Button size="sm" onClick={() => docs.revenue(p)}>
                          Revenue
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void duplicate(p)}
                        >
                          Duplicate
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDel(p)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <ConfirmModal
        open={!!del}
        title="Delete this project?"
        danger
        confirmLabel="Delete permanently"
        message={
          del && (
            <>
              <p>
                <b>{clientDisplayName(del)} — {del.title}</b> ({del.quoteNumber}) and all its invoices, payments, receipts, commission and expense records will be deleted from this browser.
              </p>
              {del.payments.some((x) => x.status === 'verified') && <p className="mt-2 font-medium text-red-700">This project has verified payments. Export a backup first if you may need these records.</p>}
            </>
          )
        }
        onClose={() => setDel(null)}
        onConfirm={() => {
          if (!del) return;
          deleteProject(del.id);
          toast('Project deleted');
        }}
      />
    </div>
  );
}

export function BackupButtons() {
  const { data, replaceAll, toast } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<AppData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <>
      <Button onClick={() => downloadText(`create-backup-${todayISO()}.json`, exportAppData(data), 'application/json')}>Export JSON backup</Button>
      <Button onClick={() => fileRef.current?.click()}>Import backup</Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const res = importAppData(await f.text());
          if (res.errors.length) {
            setErrors(res.errors);
            return;
          }
          setPending(res.data);
        }}
      />
      <ConfirmModal
        open={!!pending}
        title="Replace all data with this backup?"
        danger
        confirmLabel="Replace my data"
        message={`The backup has ${pending?.projects.length ?? 0} projects. Everything currently in this browser (${data.projects.length} projects and settings) will be replaced. Export a backup first if unsure.`}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          replaceAll(pending)
            .then(() => toast('Backup imported'))
            .catch((e: Error) => toast(`Import failed: ${e.message}`, 'err'));
        }}
      />
      <ConfirmModal
        open={errors.length > 0}
        title="Backup could not be imported"
        confirmLabel="OK"
        message={
          <div className="space-y-2">
            <Notice tone="red">Nothing was changed.</Notice>
            <ul className="list-disc pl-5">
              {errors.slice(0, 8).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        }
        onClose={() => setErrors([])}
        onConfirm={() => setErrors([])}
      />
    </>
  );
}
