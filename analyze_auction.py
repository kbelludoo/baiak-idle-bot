import urllib.request, urllib.parse, json, time

token = ''
try:
    with open('/home/ubuntu/baiak-bot/.env') as f:
        for line in f:
            if line.startswith('BAIAK_TOKEN='):
                token = line.split('=', 1)[1].strip()
except Exception:
    pass

if not token:
    import sys
    token = sys.argv[1] if len(sys.argv) > 1 else ''

def trpc_query(path, input_data=None):
    url = f'https://baiakidle.com/api/trpc/{path}'
    if input_data is not None:
        q = urllib.parse.quote(json.dumps({'json': input_data}))
        url += f'?input={q}'
    headers = {'Cookie': f'token={token}', 'User-Agent': 'Mozilla/5.0'}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))['result']['data']

# Fetch History (pages 1 to 10 = 240 sales)
history_rows = []
for p in range(1, 11):
    try:
        h = trpc_query('auction.history', {'page': p, 'perPage': 24, 'sort': 'desc'})
        rows = h.get('rows', [])
        history_rows.extend(rows)
        if len(rows) < 24:
            break
    except Exception as e:
        print(f'Error hist page {p}: {e}')
        break

# Fetch Active (first 5 pages = 120 items)
browse_rows = []
for p in range(1, 6):
    try:
        b = trpc_query('auction.browse', {'page': p, 'perPage': 24, 'sort': 'asc'})
        rows = b.get('rows', [])
        browse_rows.extend(rows)
        if len(rows) < 24:
            break
    except Exception as e:
        print(f'Error browse page {p}: {e}')
        break

print(f'=== TOTAL ANALISADO: {len(history_rows)} LEILOES ENCERRADOS | {len(browse_rows)} ATIVOS ===\n')

gold_sales = []
item_sales = {}

for r in history_rows:
    status = r.get('status')
    price = r.get('currentPrice', 0)
    bids = r.get('bidCount', 0)
    t = r.get('type')
    
    if t == 'gold':
        amt = r.get('goldAmount', 0)
        gold_kk = amt / 1000000.0
        ratio = (amt / max(1, price)) / 1000000.0 # kk por coin
        gold_sales.append({
            'id': r.get('id'),
            'gold_kk': gold_kk,
            'price_coins': price,
            'bids': bids,
            'gold_per_coin_kk': ratio,
            'status': status
        })
    elif t == 'item':
        item_info = r.get('item', {}) or {}
        name = item_info.get('name', 'unknown')
        tier = item_info.get('tier', 0)
        up = item_info.get('upLevel', 0)
        key = f"{name} (T{tier})"
        item_sales.setdefault(key, []).append({
            'id': r.get('id'),
            'price': price,
            'bids': bids,
            'status': status,
            'up': up
        })

print('--- 1. HISTORICO DE PACOTES DE GOLD (VALOR DE MERCADO DO GOLD EM COINS) ---')
for g in gold_sales[:15]:
    print(f"#{g['id']}: {g['gold_kk']:.1f}kk por {g['price_coins']} coins ({g['bids']} lances) -> {g['gold_per_coin_kk']:.2f}kk/coin")

if gold_sales:
    avg_ratio = sum(g['gold_per_coin_kk'] for g in gold_sales) / len(gold_sales)
    min_ratio = min(g['gold_per_coin_kk'] for g in gold_sales)
    max_ratio = max(g['gold_per_coin_kk'] for g in gold_sales)
    print(f"\n=> TAXA MEDIA DO GOLD: 1 COIN = {avg_ratio:.2f}kk")
    print(f"=> MAXIMA OBTIDA (MELHOR COMPRA DE QUEM COMPROU): 1 COIN = {max_ratio:.2f}kk")
    print(f"=> MINIMA OBTIDA (MELHOR VENDA DE QUEM VENDEU):   1 COIN = {min_ratio:.2f}kk\n")

print('--- 2. TOP ITENS MAIS LIQUIDOS E LUCRATIVOS NO HISTORICO ---')
sorted_items = sorted(item_sales.items(), key=lambda x: (len(x[1]), sum(s['bids'] for s in x[1])), reverse=True)
for item_name, sales in sorted_items[:25]:
    prices = [s['price'] for s in sales]
    avg_price = sum(prices) / float(len(prices))
    max_price = max(prices)
    min_price = min(prices)
    total_bids = sum(s['bids'] for s in sales)
    single_bid_count = sum(1 for s in sales if s['bids'] <= 1)
    print(f"{item_name:36} | {len(sales):2} vendas | Min: {min_price:3}c | Med: {avg_price:5.1f}c | Max: {max_price:3}c | Lances: {total_bids:2} ({single_bid_count} sairam pelo minimo!)")

print('\n--- 3. LEILOES ATIVOS COM POTENCIAL DE SNIPER / ARBITRAGEM ---')
now_ts = int(time.time() * 1000)
opps = []
for r in browse_rows:
    ends_at = r.get('endsAt', 0)
    mins_left = max(0, (ends_at - now_ts) // 60000)
    price = r.get('currentPrice', 0)
    bids = r.get('bidCount', 0)
    t = r.get('type')
    
    if t == 'gold':
        amt = r.get('goldAmount', 0) / 1000000.0
        ratio = amt / max(1, price)
        opps.append({
            'desc': f"[GOLD] {amt:.1f}kk por {price} coins -> {ratio:.2f}kk/coin (Media: {avg_ratio:.2f}kk)",
            'id': r.get('id'),
            'mins': mins_left,
            'bids': bids,
            'ratio': ratio
        })
    elif t == 'item':
        item = r.get('item', {}) or {}
        name = item.get('name')
        tier = item.get('tier', 0)
        up = item.get('upLevel', 0)
        attrs = len(item.get('attrs', []))
        key = f"{name} (T{tier})"
        hist = item_sales.get(key, [])
        hist_prices = [s['price'] for s in hist] if hist else []
        avg_hist = sum(hist_prices) / float(len(hist_prices)) if hist_prices else 0
        opps.append({
            'desc': f"[ITEM] {name} (T{tier}, +{up}, {attrs} attrs) - Lance Atual: {price}c (Hist Med: {avg_hist:.1f}c)",
            'id': r.get('id'),
            'mins': mins_left,
            'bids': bids,
            'margin': (avg_hist - price) if avg_hist > 0 else 0
        })

# Ordenados por tempo restante
opps = sorted(opps, key=lambda x: x['mins'])
for o in opps[:30]:
    print(f"#{o['id']} | Termina em: {o['mins']:3} min | Lances: {o['bids']} | {o['desc']}")
