"""Independent checker for the C.R.E.A.T.E. revenue engine.

Re-computes every figure from the written business rules using Python's Decimal
(no code shared with the app) and compares it with what the app produced.
Usage: python3 scripts/oracle.py cases.json
"""
import json, sys
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_FLOOR

def pct_half_up(amount, bps):
    return int((D(amount) * D(bps) / D(10000)).quantize(D(1), rounding=ROUND_HALF_UP))

def pct_floor(amount, bps):
    return int((D(amount) * D(bps) / D(10000)).quantize(D(1), rounding=ROUND_FLOOR))

def split(total, parts):
    assert sum(b for _, b, _ in parts) == 10000
    out = {pid: (0 if ag else pct_floor(total, b)) for pid, b, ag in parts}
    agency = [pid for pid, _, ag in parts if ag][0]
    out[agency] = total - sum(v for k, v in out.items() if k != agency)
    return out

def months_between(a, b):
    y1, m1, d1 = map(int, a.split('-')); y2, m2, d2 = map(int, b.split('-'))
    m = (y2 - y1) * 12 + (m2 - m1)
    return m - 1 if d2 < d1 else m

def check(case):
    i, o = case['input'], case['output']
    errs = []
    def eq(name, got, want):
        if got != want: errs.append(f'{name}: app={got} oracle={want}')
    subtotal = i['base'] + sum(u * q for u, q in i['lines'])
    dsc = i['discount']; raw = 0
    if dsc['type'] == 'amount': raw = min(max(dsc['amountKobo'], 0), subtotal)
    if dsc['type'] == 'percent': raw = pct_half_up(subtotal, min(max(dsc['bps'], 0), 10000))
    discount = raw if dsc['approved'] else 0
    total = subtotal - discount
    deposit = pct_half_up(total, i['depositBps'])
    t = o['totals']
    eq('subtotal', t['subtotal'], subtotal); eq('discount', t['discount'], discount)
    eq('pendingDiscount', t['pendingDiscount'], 0 if dsc['approved'] else raw)
    eq('total', t['total'], total); eq('deposit', t['deposit'], deposit); eq('delivery', t['delivery'], total - deposit)
    if t['deposit'] + t['delivery'] != t['total']: errs.append('deposit+delivery != total')
    verified = sum(a for a, s in i['payments'] if s == 'verified')
    pending = sum(a for a, s in i['payments'] if s == 'pending')
    ps = o['payments']
    eq('verified', ps['verified'], verified); eq('pending', ps['pending'], pending)
    eq('outstanding', ps['outstanding'], max(total - verified, 0))
    if total == 0: st = 'No charge'
    elif verified > total: st = 'Overpaid'
    elif verified == total: st = 'Fully paid'
    elif verified == 0: st = 'Unpaid'
    elif verified >= deposit: st = 'Deposit paid'
    else: st = 'Partially paid'
    eq('status', ps['status'], st)
    alloc = split(total, i['split']); cash = split(min(verified, total), i['split'])
    shares = {s['id']: s for s in o['shares']}
    if sum(s['amount'] for s in o['shares']) != total: errs.append('shares do not sum to total')
    for pid, bps, ag in i['split']:
        s = shares[pid]; paid = sum(a for p, a in i['payouts'] if p == pid)
        eq(f'{pid}.alloc', s['amount'], alloc[pid]); eq(f'{pid}.earnedOnCash', s['earnedOnCash'], cash[pid])
        eq(f'{pid}.paid', s['paid'], paid); eq(f'{pid}.unpaid', s['unpaid'], alloc[pid] - paid)
        eq(f'{pid}.dueNow', s['dueNow'], max(cash[pid] - paid, 0))
        # no share may exceed its exact fractional value by a kobo or more
        # Rounding bounds from the documented rule: developer shares are at most 1 kobo below their exact
        # value; the agency (exact remainder) is at most 1 kobo above per developer share.
        exact = D(total) * D(bps) / D(10000)
        diff = D(s['amount']) - exact
        n_devs = len(i['split']) - 1
        if not ag and not (D(-1) < diff <= 0): errs.append(f'{pid} rounding outside (-1, 0] kobo: {diff}')
        if ag and not (D(0) <= diff < D(n_devs)): errs.append(f'agency rounding outside [0, {n_devs}) kobo: {diff}')
    agency = [pid for pid, _, ag in i['split'] if ag][0]
    eq('agencyAfterExpenses', o['agencyAfterExpenses'], alloc[agency] - sum(i['expenses']))
    m, mo = i['maintenance'], o['maintenance']
    received = sum(m['received'])
    if not m['enabled'] or m['fee'] <= 0:
        eq('maint.active', mo['active'], False); eq('maint.monthly', mo['monthly'], 0)
    else:
        per_year = {'monthly': 12, 'quarterly': 4, 'annually': 1}[m['freq']]
        months = {'monthly': 1, 'quarterly': 3, 'annually': 12}[m['freq']]
        annual = m['fee'] * per_year
        monthly = int((D(annual) / D(12)).quantize(D(1), rounding=ROUND_HALF_UP))
        asof = '2026-10-31'
        periods = (months_between(m['start'], asof) // months + 1) if m['start'] <= asof else 0
        billed = periods * m['fee']
        eq('maint.annual', mo['annual'], annual); eq('maint.monthly', mo['monthly'], monthly)
        eq('maint.periods', mo['periodsBilled'], periods); eq('maint.billed', mo['billedToDate'], billed)
        eq('maint.received', mo['received'], received); eq('maint.outstanding', mo['outstanding'], max(billed - received, 0))
    return errs

cases = json.load(open(sys.argv[1]))
fails = 0; checks = 0
stats = {'fractional_kobo_splits': 0, 'custom_split': 0, 'discounted': 0, 'fully_paid': 0, 'overpaid': 0, 'partial': 0, 'maintenance': 0}
for n, c in enumerate(cases):
    e = check(c); checks += 1
    t = c['output']['totals']['total']
    if any((t * b) % 10000 for _, b, _ in c['input']['split']): stats['fractional_kobo_splits'] += 1
    if [b for _, b, _ in c['input']['split']] != [2500, 2500, 5000]: stats['custom_split'] += 1
    if c['output']['totals']['discount'] > 0: stats['discounted'] += 1
    st = c['output']['payments']['status']
    stats['fully_paid'] += st == 'Fully paid'; stats['overpaid'] += st == 'Overpaid'
    stats['partial'] += st in ('Partially paid', 'Deposit paid'); stats['maintenance'] += c['output']['maintenance']['active']
    if e:
        fails += 1
        if fails <= 5: print(f'CASE {n} FAILED:', e[:4])
print(f'{checks} projects checked, {fails} mismatches')
print('coverage:', stats)
sys.exit(1 if fails else 0)
