import { useState } from 'react';
import { PdfProvider } from './components/pdf-preview';
import { AuthGate, useSession } from './components/AuthGate';
import { Button, Modal, cx } from './components/ui';
import { clientDisplayName, formatDate } from './lib/calc';
import { go, useRoute } from './lib/router';
import { useStore } from './lib/store';
import { Calculator } from './views/Calculator';
import { Distribution } from './views/Distribution';
import { History } from './views/History';
import { Invoices } from './views/Invoices';
import { Overview } from './views/Overview';
import { Quotations } from './views/Quotations';
import { Receipts } from './views/Receipts';
import { Settings } from './views/Settings';

const NAV: { view: string; label: string; icon: string }[] = [
  { view: 'overview', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { view: 'calculator', label: 'New Project / Calculator', icon: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 19h0' },
  { view: 'quotations', label: 'Quotations', icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6' },
  { view: 'invoices', label: 'Invoices', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6' },
  { view: 'receipts', label: 'Receipts & Payments', icon: 'M4 7h16v10H4zM4 11h16M8 15h2' },
  { view: 'distribution', label: 'Revenue Distribution', icon: 'M12 3v9l7 4M12 21a9 9 0 110-18 9 9 0 010 18z' },
  { view: 'history', label: 'Project History', icon: 'M12 7v5l3 3M12 21a9 9 0 110-18 9 9 0 010 18z' },
  { view: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2l-2 2-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Brand() {
  return (
    <div>
      <p className="text-lg font-bold tracking-wide text-ink">
        C.R.E.A.T.E.<span className="text-ochre">•</span>
      </p>
      <p className="text-[11px] text-muted">Revenue & Project Finance</p>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const { toastState, sync, conflict, resolveConflict, backendKind } = useStore();
  const session = useSession();
  const [menu, setMenu] = useState(false);
  const view = NAV.some((n) => n.view === route.view) ? route.view : 'overview';

  const nav = (
    <nav className="space-y-1">
      {NAV.map((n) => (
        <button
          key={n.view}
          onClick={() => {
            go(n.view);
            setMenu(false);
          }}
          className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition', view === n.view ? 'bg-espresso font-medium text-cream' : 'text-espresso hover:bg-cream-2')}
          aria-current={view === n.view ? 'page' : undefined}
        >
          <Icon d={n.icon} />
          {n.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-cream px-4 py-6 lg:flex">
        <div className="mb-8 px-2">
          <Brand />
        </div>
        {nav}
        <div className="mt-auto space-y-3">
          <SyncChip />
          <div className="rounded-2xl bg-cream-2 p-3 text-[11px] leading-relaxed text-muted">
            <p className="truncate font-medium text-espresso" title={session.email}>{session.email}</p>
            <p>{backendKind === 'supabase' ? 'Shared team database' : 'Offline demo — this browser only'}</p>
            <button onClick={session.signOut} className="mt-1.5 font-medium text-ochre-dark underline">
              {backendKind === 'supabase' ? 'Sign out' : 'Exit demo mode'}
            </button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-line bg-cream/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <div className="ml-auto mr-2"><SyncChip compact /></div>
        <button onClick={() => setMenu((m) => !m)} className="rounded-xl border border-line bg-white p-2" aria-label="Menu" aria-expanded={menu}>
          <Icon d={menu ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </button>
      </header>
      {menu && (
        <div className="no-print fixed inset-x-0 top-[61px] z-30 max-h-[85vh] overflow-y-auto border-b border-line bg-cream p-3 shadow-lg lg:hidden">
          {nav}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line px-3 pt-3 text-xs text-muted">
            <span className="truncate">{session.email}</span>
            <button onClick={session.signOut} className="font-medium text-ochre-dark underline">
              {backendKind === 'supabase' ? 'Sign out' : 'Exit demo'}
            </button>
          </div>
        </div>
      )}

      <main className="px-4 py-6 sm:px-6 lg:ml-64 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">
          {(sync.status === 'offline' || sync.status === 'error') && sync.message && (
            <div role="alert" className={cx('mb-5 rounded-2xl border px-4 py-3 text-sm', sync.status === 'offline' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800')}>
              {sync.message}
            </div>
          )}
          {backendKind === 'local' && (
            <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Offline demo mode — no password and nothing is shared. Connect your Supabase database to use team logins.</div>
          )}
          {view === 'overview' && <Overview />}
          {view === 'calculator' && <Calculator editId={route.id} />}
          {view === 'quotations' && <Quotations />}
          {view === 'invoices' && <Invoices route={route} />}
          {view === 'receipts' && <Receipts route={route} />}
          {view === 'distribution' && <Distribution route={route} />}
          {view === 'history' && <History />}
          {view === 'settings' && <Settings />}
        </div>
      </main>

      <Modal
        open={!!conflict}
        onClose={() => resolveConflict('theirs')}
        title="Someone else changed this project"
        footer={
          <>
            <Button onClick={() => resolveConflict('theirs')}>Use their version</Button>
            <Button variant="primary" onClick={() => resolveConflict('mine')}>
              Keep my version
            </Button>
          </>
        }
      >
        {conflict && (
          <div className="space-y-2 text-sm text-espresso">
            <p>
              <b>{clientDisplayName(conflict.mine)} — {conflict.mine.title}</b> was {conflict.theirs ? 'saved by a teammate' : 'deleted by a teammate'} while you were working on it, so your latest change has not been saved yet.
            </p>
            {conflict.theirs && <p className="text-muted">Their version was saved {formatDate(conflict.theirs.project.updatedAt.slice(0, 10))}. “Keep my version” replaces theirs with yours. “Use their version” throws away your last change.</p>}
            {!conflict.theirs && <p className="text-muted">“Keep my version” saves your copy again. “Use their version” removes it.</p>}
            <p className="text-xs text-muted">Either way, the database keeps a history copy of both.</p>
          </div>
        )}
      </Modal>

      {toastState && (
        <div role="status" className={cx('no-print fixed bottom-24 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium shadow-xl lg:bottom-6', toastState.kind === 'err' ? 'bg-red-700 text-white' : 'bg-espresso text-cream')}>
          {toastState.msg}
        </div>
      )}
    </div>
  );
}

function SyncChip({ compact }: { compact?: boolean }) {
  const { sync, backendKind } = useStore();
  if (backendKind === 'local') return null;
  const look = {
    saved: ['bg-emerald-500', 'All changes saved'],
    saving: ['bg-amber-400 animate-pulse', sync.pending > 1 ? `Saving ${sync.pending} changes…` : 'Saving…'],
    offline: ['bg-amber-500', 'Offline — will retry'],
    error: ['bg-red-500', 'Not saved'],
  }[sync.status];
  return (
    <div aria-live="polite" data-sync={sync.status} className={cx('flex items-center gap-2 rounded-full border border-line bg-white text-xs text-espresso', compact ? 'px-2.5 py-1' : 'px-3 py-1.5')} title={sync.message ?? look[1]}>
      <span className={cx('inline-block h-2 w-2 rounded-full', look[0])} />
      <span className={compact ? 'hidden sm:inline' : ''}>{look[1]}</span>
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <PdfProvider>
        <Shell />
      </PdfProvider>
    </AuthGate>
  );
}
