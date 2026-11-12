/**
 * Money helpers.
 *
 * Every amount in this app is stored as an INTEGER number of kobo
 * (₦1 = 100 kobo). Percentages are stored as INTEGER basis points
 * (1% = 100 bps, 25% = 2500 bps, 100% = 10000 bps).
 *
 * Because amounts are whole numbers, adding and subtracting is exact.
 * The only place rounding can happen is when a percentage is applied,
 * and every such place goes through the functions below so the rule is
 * the same everywhere.
 *
 * ROUNDING RULES (documented, used throughout):
 *  1. percentOf()  – rounds to the nearest kobo, halves round up
 *                    (used for percentage discounts and the deposit).
 *  2. splitByBps() – each developer share is rounded DOWN to the whole
 *                    kobo; the agency receives the exact remainder, so the
 *                    shares always add up to exactly the project total.
 *  3. Delivery balance = total − deposit (exact remainder, never rounded).
 */

export type Kobo = number;
export type Bps = number;

export const BPS_100 = 10000;

/** Throws if a value is not a safe whole number. Guards every calculation. */
export function assertKobo(v: number, label = 'amount'): Kobo {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be a whole number of kobo (got ${v})`);
  return v;
}

/** Multiply then divide using BigInt so very large values can never lose precision. */
function mulDiv(a: number, b: number, d: number): { q: bigint; r: bigint; d: bigint } {
  const n = BigInt(a) * BigInt(b);
  const D = BigInt(d);
  return { q: n / D, r: n % D, d: D };
}

/** amount × bps / 10000, rounded to the nearest kobo (half up). Amount must be ≥ 0. */
export function percentOf(amount: Kobo, bps: Bps): Kobo {
  assertKobo(amount);
  assertKobo(bps, 'percentage');
  if (amount < 0 || bps < 0) throw new Error('percentOf expects non-negative values');
  const { q, r, d } = mulDiv(amount, bps, BPS_100);
  return Number(r * 2n >= d ? q + 1n : q);
}

/** amount × bps / 10000 rounded DOWN to the kobo. */
export function percentOfFloor(amount: Kobo, bps: Bps): Kobo {
  assertKobo(amount);
  const { q } = mulDiv(amount, bps, BPS_100);
  return Number(q);
}

export interface SplitPart {
  id: string;
  name: string;
  role: string;
  bps: Bps;
  isAgency: boolean;
}

export interface SplitResult extends SplitPart {
  amount: Kobo;
}

/**
 * Split a total between participants.
 * Non-agency shares are rounded down; the agency gets the exact remainder.
 * The result ALWAYS sums to `total` exactly.
 */
export function splitByBps(total: Kobo, parts: SplitPart[]): SplitResult[] {
  assertKobo(total, 'total');
  const sum = parts.reduce((s, p) => s + p.bps, 0);
  if (sum !== BPS_100) throw new Error(`Revenue split must add up to 100% (currently ${bpsToPercentText(sum)})`);
  const agencyCount = parts.filter((p) => p.isAgency).length;
  if (agencyCount !== 1) throw new Error('Revenue split needs exactly one agency share');
  const out: SplitResult[] = parts.map((p) => ({ ...p, amount: p.isAgency ? 0 : percentOfFloor(total, p.bps) }));
  const others = out.reduce((s, p) => s + p.amount, 0);
  const agency = out.find((p) => p.isAgency)!;
  agency.amount = total - others;
  return out;
}

/** Format kobo as "₦1,234,567.89". */
export function formatNaira(k: Kobo, opts: { symbol?: string; decimals?: boolean } = {}): string {
  const symbol = opts.symbol ?? '₦';
  const neg = k < 0;
  const abs = Math.abs(k);
  const naira = Math.floor(abs / 100);
  const kobo = abs % 100;
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = opts.decimals === false ? '' : '.' + kobo.toString().padStart(2, '0');
  return `${neg ? '−' : ''}${symbol}${whole}${dec}`;
}

/** Short format for dashboard cards: ₦1.25m, ₦850k, ₦99,999 */
export function formatNairaShort(k: Kobo): string {
  const n = k / 100;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '−' : ''}₦${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
  return formatNaira(k, { decimals: k % 100 !== 0 });
}

/**
 * Parse what a person typed ("₦129,999", "15000", "1,250.5") into kobo.
 * Returns null when the text is not a valid non-negative amount with at most 2 decimals.
 * Parsing is done on the string, never with floating-point multiplication.
 */
export function parseNaira(input: string): Kobo | null {
  const s = input.replace(/[₦,\s]/g, '').replace(/^NGN/i, '');
  if (s === '') return null;
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const naira = m[1].replace(/^0+(?=\d)/, '');
  const kobo = (m[2] ?? '').padEnd(2, '0');
  const v = Number(naira) * 100 + Number(kobo);
  return Number.isSafeInteger(v) ? v : null;
}

/** Kobo -> plain editable text without symbol: 1500000 -> "15,000" ; 1050 -> "10.50" */
export function koboToInput(k: Kobo): string {
  return formatNaira(k, { symbol: '', decimals: k % 100 !== 0 });
}

export function bpsToPercentText(b: Bps): string {
  const whole = Math.floor(b / 100);
  const frac = b % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}%`;
}

/** "25" or "12.5" -> 2500 / 1250 bps. Up to 2 decimals. */
export function parsePercent(input: string): Bps | null {
  const s = input.replace(/[%\s]/g, '');
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return v <= BPS_100 ? v : null;
}
