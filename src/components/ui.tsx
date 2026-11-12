import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { bpsToPercentText, koboToInput, parseNaira, parsePercent, type Bps, type Kobo } from '../lib/money';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* --------------------------------------------------------------- layout */

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-3xl border border-line bg-white/80 shadow-[0_1px_0_rgba(45,41,40,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ochre">{eyebrow}</p>}
        <h1 className="font-serif text-4xl leading-tight text-ink sm:text-[2.6rem]">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- buttons */

type BtnVariant = 'primary' | 'dark' | 'ghost' | 'danger' | 'soft';
export function Button({ variant = 'ghost', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-ochre text-white hover:bg-ochre-dark border-transparent',
    dark: 'bg-espresso text-cream hover:bg-ink border-transparent',
    ghost: 'bg-white text-ink border-line hover:border-espresso/30 hover:bg-cream',
    soft: 'bg-ochre-soft text-ochre-dark border-transparent hover:bg-ochre/20',
    danger: 'bg-white text-red-700 border-red-200 hover:bg-red-50',
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        v[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- fields */

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Naira input that stores integer kobo. Shows an error for invalid or negative input. */
export function MoneyInput({ value, onChange, id, disabled, placeholder, allowEmpty }: { value: Kobo | null; onChange: (v: Kobo | null) => void; id?: string; disabled?: boolean; placeholder?: string; allowEmpty?: boolean }) {
  const [text, setText] = useState(value === null ? '' : koboToInput(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const parsed = parseNaira(text);
    if (parsed !== value) setText(value === null ? '' : koboToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₦</span>
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          placeholder={placeholder ?? '0'}
          className={cx('input tnum pl-7', bad && 'input-error')}
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') {
              setBad(!allowEmpty);
              onChange(allowEmpty ? null : 0);
              return;
            }
            const k = parseNaira(t);
            setBad(k === null);
            if (k !== null) onChange(k);
          }}
          onBlur={() => {
            const k = parseNaira(text);
            if (k !== null) setText(koboToInput(k));
          }}
        />
      </div>
      {bad && <p className="mt-1 text-xs text-red-600">{text.trim() === '' ? 'Enter an amount.' : 'Use numbers only, e.g. 15000 or 15,000.50 (no negatives).'}</p>}
    </div>
  );
}

export function PercentInput({ value, onChange, id, disabled }: { value: Bps; onChange: (v: Bps) => void; id?: string; disabled?: boolean }) {
  const [text, setText] = useState(bpsToPercentText(value).replace('%', ''));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parsePercent(text) !== value) setText(bpsToPercentText(value).replace('%', ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          className={cx('input tnum pr-8', bad && 'input-error')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const b = parsePercent(e.target.value);
            setBad(b === null);
            if (b !== null) onChange(b);
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
      </div>
      {bad && <p className="mt-1 text-xs text-red-600">Enter 0–100 with up to 2 decimals.</p>}
    </div>
  );
}

export function QtyInput({ value, onChange, disabled, min = 1 }: { value: number; onChange: (v: number) => void; disabled?: boolean; min?: number }) {
  return (
    <div className="flex items-center rounded-xl border border-line bg-white">
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} className="px-2.5 py-1.5 text-muted hover:text-ink disabled:opacity-30" aria-label="Decrease">
        −
      </button>
      <input
        inputMode="numeric"
        disabled={disabled}
        className="tnum w-10 bg-transparent text-center text-sm outline-none"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''));
          if (Number.isInteger(n) && n >= min && n <= 999) onChange(n);
        }}
        aria-label="Quantity"
      />
      <button type="button" disabled={disabled || value >= 999} onClick={() => onChange(value + 1)} className="px-2.5 py-1.5 text-muted hover:text-ink disabled:opacity-30" aria-label="Increase">
        +
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2.5 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#C2693A]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------ displays */

export type Tone = 'green' | 'amber' | 'red' | 'grey' | 'ochre' | 'dark' | 'blue';
export function Badge({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = {
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    grey: 'bg-cream-2 text-muted ring-line',
    ochre: 'bg-ochre-soft text-ochre-dark ring-ochre/20',
    dark: 'bg-espresso text-cream ring-espresso',
    blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', t[tone])}>{children}</span>;
}

export function paymentTone(s: string): Tone {
  if (s === 'Fully paid') return 'green';
  if (s === 'Deposit paid') return 'blue';
  if (s === 'Partially paid') return 'amber';
  if (s === 'Overpaid') return 'red';
  if (s === 'Unpaid') return 'grey';
  return 'grey';
}

export function projectTone(s: string): Tone {
  if (s === 'Completed') return 'green';
  if (s === 'Delivered') return 'blue';
  if (s === 'In progress' || s === 'Approved') return 'ochre';
  if (s === 'Cancelled') return 'red';
  return 'grey';
}

export function Stat({ label, value, sub, tone = 'default', title }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'accent' | 'dark' | 'warn'; title?: string }) {
  const styles = {
    default: 'bg-white border-line',
    accent: 'bg-ochre-soft border-ochre/20',
    dark: 'bg-espresso border-espresso text-cream',
    warn: 'bg-amber-50 border-amber-200',
  }[tone];
  return (
    <div className={cx('rounded-2xl border p-4', styles)} title={title}>
      <p className={cx('text-[11px] font-medium uppercase tracking-wider', tone === 'dark' ? 'text-cream/70' : 'text-muted')}>{label}</p>
      <p className={cx('tnum mt-1.5 text-xl font-semibold sm:text-[22px]', tone === 'dark' ? 'text-cream' : 'text-ink')}>{value}</p>
      {sub && <p className={cx('mt-1 text-xs', tone === 'dark' ? 'text-cream/70' : 'text-muted')}>{sub}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-cream/60 px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'amber', children }: { tone?: 'amber' | 'red' | 'blue' | 'green'; children: ReactNode }) {
  const t = { amber: 'bg-amber-50 border-amber-200 text-amber-900', red: 'bg-red-50 border-red-200 text-red-800', blue: 'bg-sky-50 border-sky-200 text-sky-900', green: 'bg-emerald-50 border-emerald-200 text-emerald-900' }[tone];
  return <div className={cx('rounded-2xl border px-4 py-3 text-sm', t)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={cx('flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl bg-cream shadow-2xl sm:rounded-3xl', wide ? 'max-w-5xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="min-w-0 truncate font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-cream-2 hover:text-ink" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className={danger ? '!bg-red-600 !text-white !border-red-600 hover:!bg-red-700' : ''}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-espresso">{message}</div>
    </Modal>
  );
}

/** Simple responsive table wrapper. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-5 overflow-x-auto px-5">{children}</div>;
}

export const th = 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted';
export const td = 'border-b border-line px-3 py-3 align-top text-sm';
