import { useState } from 'react';
import { DocButtons, useDocs } from '../components/doc-actions';
import { useDuplicate } from '../components/shared';
import { Badge, Button, Card, Empty, PageHeader, TableWrap, projectTone, td, th } from '../components/ui';
import { clientDisplayName, computeTotals, formatDate, todayISO } from '../lib/calc';
import { formatNaira } from '../lib/money';
import { go } from '../lib/router';
import { useStore } from '../lib/store';

export function Quotations() {
  const { data } = useStore();
  const duplicate = useDuplicate();
  const docs = useDocs();
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const today = todayISO();
  const list = data.projects
    .filter((p) => !onlyOpen || p.projectStatus === 'Quotation')
    .filter((p) => `${p.quoteNumber} ${p.client.fullName} ${p.client.business} ${p.title}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));

  return (
    <div>
      <PageHeader eyebrow="Client documents" title="Quotations">
        <Button variant="primary" onClick={() => go('calculator')}>
          + New quotation
        </Button>
      </PageHeader>
      <Card
        title={`${list.length} quotation${list.length === 1 ? '' : 's'}`}
        actions={
          <>
            <input className="input w-56" placeholder="Search client or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search quotations" />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" className="accent-[#C2693A]" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Not yet approved
            </label>
          </>
        }
      >
        {list.length === 0 ? (
          <Empty title="No quotations yet">Create one from the calculator.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Client / project</th>
                  <th className={th}>Package</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={th}>Valid until</th>
                  <th className={th}>Status</th>
                  <th className={th}>Quotation PDF</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const t = computeTotals(p);
                  const expired = p.projectStatus === 'Quotation' && p.quoteValidUntil && p.quoteValidUntil < today;
                  return (
                    <tr key={p.id} className="hover:bg-cream/60">
                      <td className={`${td} tnum font-medium`}>{p.quoteNumber}</td>
                      <td className={td}>
                        <p className="font-medium">{clientDisplayName(p)}</p>
                        <p className="text-xs text-muted">{p.title}</p>
                      </td>
                      <td className={td}>{p.packageName}</td>
                      <td className={`${td} tnum text-right font-semibold`}>{formatNaira(t.total)}</td>
                      <td className={td}>
                        {formatDate(p.quoteValidUntil)} {expired && <Badge tone="amber">Expired</Badge>}
                      </td>
                      <td className={td}>
                        <Badge tone={projectTone(p.projectStatus)}>{p.projectStatus}</Badge>
                      </td>
                      <td className={td}>
                        <DocButtons compact onRun={(m) => docs.quotation(p, m)} />
                      </td>
                      <td className={td}>
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => go(`calculator/${p.id}`)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void duplicate(p)}
                          >
                            Duplicate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
