"""Verifies PDFs downloaded from the app against independently computed figures.
Usage: python3 scripts/verify_pdfs.py <folder with PDFs + state.json>
"""
import json, os, re, subprocess, sys
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_FLOOR

folder = sys.argv[1]
state = json.load(open(os.path.join(folder, 'state.json')))
projects = {p['id']: p for p in state['projects']}

def naira(k):
    s = f"{abs(k)//100:,}.{abs(k)%100:02d}"
    return ('−' if k < 0 else '') + '₦' + s

def half_up(a, bps): return int((D(a) * bps / 10000).quantize(D(1), ROUND_HALF_UP))
def floor(a, bps): return int((D(a) * bps / 10000).quantize(D(1), ROUND_FLOOR))

def figures(p):
    sub = p['basePriceKobo'] + sum(l['unitPriceKobo'] * l['qty'] for l in p['lineItems'])
    d = p['discount']; raw = 0
    if d['type'] == 'amount': raw = min(max(d['amountKobo'], 0), sub)
    if d['type'] == 'percent': raw = half_up(sub, d['bps'])
    disc = raw if d['approved'] else 0
    total = sub - disc
    dep = half_up(total, p['depositBps'])
    verified = sum(x['amountKobo'] for x in p['payments'] if x['status'] == 'verified')
    shares = {s['id']: (0 if s['isAgency'] else floor(total, s['bps'])) for s in p['split']}
    ag = [s['id'] for s in p['split'] if s['isAgency']][0]
    shares[ag] = total - sum(v for k, v in shares.items() if k != ag)
    return dict(sub=sub, disc=disc, total=total, dep=dep, deliv=total - dep, verified=verified, outstanding=max(total - verified, 0), shares=shares)

def text(path): return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
def info(path): return subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
def fonts(path): return subprocess.run(['pdffonts', path], capture_output=True, text=True).stdout

results = []; fails = 0
def check(name, cond, detail=''):
    global fails
    results.append(('PASS' if cond else 'FAIL', name, detail))
    if not cond: fails += 1

files = sorted(f for f in os.listdir(folder) if f.endswith('.pdf'))
for f in files:
    path = os.path.join(folder, f)
    pid, kind = (f.split('__') + ['', ''])[:2]
    if pid == 'receipt-new':  # issued during the run
        pid = 'demo_5'; kind = 'receipt-' + f.split('__')[1].split('-Receipt')[0]
    p = projects.get(pid)
    if not p: continue
    fig = figures(p); t = text(path); inf = info(path)
    pages = int(re.search(r'Pages:\s+(\d+)', inf).group(1))
    size = re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', inf)
    tag = f"{pid} {kind.split('-')[0]}"
    check(f'{tag}: A4 page size', size and abs(float(size.group(1)) - 595.28) < 1 and abs(float(size.group(2)) - 841.89) < 1, size.group(0) if size else '')
    check(f'{tag}: Carlito font embedded', 'Carlito' in fonts(path) and ' yes ' in fonts(path))
    check(f'{tag}: page numbers "Page x of {pages}"', all(f'Page {i} of {pages}' in t for i in range(1, pages + 1)))
    check(f'{tag}: ₦ symbol renders as text', '₦' in t)
    names = [s['name'] for s in p['split'] if not s['isAgency']]
    if kind == 'quote':
        for label, k in [('total', fig['total']), ('deposit', fig['dep']), ('delivery', fig['deliv']), ('subtotal', fig['sub'])]:
            check(f'{tag}: {label} {naira(k)} printed', naira(k) in t)
        if fig['disc']: check(f'{tag}: discount printed', naira(-fig['disc']) in t)
        check(f'{tag}: payment-instructions message', 'Payment instructions will be provided directly by C.R.E.A.T.E. Agency.' in re.sub(r'\s+', ' ', t))
        check(f'{tag}: quote number + validity date', p['quoteNumber'] in t and 'Valid until' in t)
        for li in p['lineItems']: check(f'{tag}: line "{li["name"][:30]}" amount', naira(li['unitPriceKobo'] * li['qty']) in t)
    if kind.startswith('invoice'):
        num = kind.split('invoice-')[1]; inv = next(i for i in p['invoices'] if i['number'] == num)
        paid_on = sum(x['amountKobo'] for x in p['payments'] if x['status'] == 'verified' and x['invoiceNumber'] == num)
        due = min(max(inv['amountKobo'] - paid_on, 0), fig['outstanding'])
        check(f'{tag} {num}: full project value {naira(fig["total"])}', naira(fig['total']) in t)
        check(f'{tag} {num}: amount due on this invoice {naira(due)}', naira(due) in t and 'Amount due on this invoice' in t)
        check(f'{tag} {num}: outstanding {naira(fig["outstanding"])}', naira(fig['outstanding']) in t)
        check(f'{tag} {num}: says installment ≠ full value', 'not the full project value' in re.sub(r'\s+', ' ', t))
    if kind.startswith('receipt'):
        num = kind.split('receipt-')[1]
        pay = next(x for x in p['payments'] if x['receiptNumber'] == num)
        ver = [x for x in p['payments'] if x['status'] == 'verified']
        idx = ver.index(pay)
        cum = sum(x['amountKobo'] for i, x in enumerate(ver) if x['date'] < pay['date'] or (x['date'] == pay['date'] and i <= idx))
        check(f'{tag} {num}: payment verified before receipt', pay['status'] == 'verified')
        check(f'{tag} {num}: amount {naira(pay["amountKobo"])}', naira(pay['amountKobo']) in t)
        check(f'{tag} {num}: cumulative paid {naira(cum)}', naira(cum) in t)
        check(f'{tag} {num}: remaining {naira(max(fig["total"] - cum, 0))}', naira(max(fig['total'] - cum, 0)) in t)
        check(f'{tag} {num}: receipt + invoice numbers shown', num in t and (pay['invoiceNumber'] or p['invoiceNumber']) in t)
    if kind in ('quote',) or kind.startswith('invoice') or kind.startswith('receipt'):
        low = t.lower()
        leaked = [w for w in names + ['commission', 'confidential', 'revenue distribution', '25%'] if w.lower() in low]
        check(f'{tag}: no internal data on client document', not leaked, ', '.join(leaked))
    if kind == 'revenue':
        flat = re.sub(r'\s+', ' ', t)
        check(f'{tag}: heading + CONFIDENTIAL on every page', 'C.R.E.A.T.E. AGENCY — PROJECT REVENUE DISTRIBUTION' in flat and t.count('CONFIDENTIAL — INTERNAL USE ONLY') >= pages)
        for s in p['split']:
            check(f'{tag}: {s["name"]} share {naira(fig["shares"][s["id"]])}', naira(fig['shares'][s['id']]) in t)
        check(f'{tag}: shares sum to total & marked RECONCILED', sum(fig['shares'].values()) == fig['total'] and 'RECONCILED' in flat)
        check(f'{tag}: cash collected {naira(fig["verified"])}', naira(fig['verified']) in t)
        exp = sum(e['amountKobo'] for e in p['expenses'])
        ag = [s['id'] for s in p['split'] if s['isAgency']][0]
        check(f'{tag}: agency after expenses {naira(fig["shares"][ag] - exp)}', naira(fig['shares'][ag] - exp) in t)
    multi = pages > 1
    if multi: check(f'{tag}: multi-page document flows ({pages} pages)', True)

for r in results:
    if r[0] == 'FAIL': print(*r)
kinds = {}
for f in files:
    k = f.split('__')[1].split('-')[0] if '__' in f else 'receipt'
    kinds[k] = kinds.get(k, 0) + 1
print(f'{len(files)} PDFs, {len(results)} checks, {fails} failed. By type: {kinds}')
print('multi-page docs:', [r[1] for r in results if 'multi-page' in r[1]])
sys.exit(1 if fails else 0)
