# Imagen de previa con alineaciones (1080x1350) para redes.
# Uso: python3 -I scripts/promo/previa.py <id_partido> [salida.png]
# Lee public/data/alineaciones.json (el partido ya tiene que estar cargado), season.json, estadios.json
# y scripts/promo/bajas.json (suspendidos y capilla por partido).
import json, sys, os, datetime
from playwright.sync_api import sync_playwright

R = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(R))
J = lambda p: json.load(open(os.path.join(ROOT, p), encoding='utf-8'))
MID = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(R, f'previa-{MID}.png')
D = J('public/data/season.json'); A = J('public/data/alineaciones.json'); E = J('public/data/estadios.json')
B = json.load(open(os.path.join(R, 'bajas.json'), encoding='utf-8')).get(MID, {})
T = D['teams']; m = next(x for x in D['matches'] if str(x['id']) == MID); L = A[MID]
H, AW = T[str(m['h'])], T[str(m['a'])]
COL = {'Alajuelense': ('#C8102E', '#fff'), 'Sporting': ('#F4F4F0', '#141A16'), 'San Carlos': ('#D7263D', '#fff'),
       'Pérez Zeledón': ('#1F6FD1', '#fff'), 'Herediano': ('#F2C811', '#B3121B'), 'Saprissa': ('#8E2B6E', '#fff'),
       'Cartaginés': ('#1F3B8A', '#fff'), 'Escorpiones Belén': ('#F5D300', '#141A16'), 'Puntarenas': ('#F37021', '#141A16'),
       'Inter San Carlos': ('#2E9E5B', '#fff')}
logo = lambda t: t['logo'] if t['logo'].startswith('http') else '../../public' + t['logo']
k = datetime.datetime.fromisoformat(m['d'].replace('Z', '+00:00')) - datetime.timedelta(hours=6)
DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']
h12 = k.hour % 12 or 12; ap = 'a. m.' if k.hour < 12 else 'p. m.'
sub = f"{DIAS[k.weekday()]} {k.day} {MES[k.month-1]} · {h12}:{k.minute:02d} {ap} · Jornada {m['r']} · {E.get(H['name'], '')}"

played = sorted([x for x in D['matches'] if x.get('hs') is not None and x['d'] < m['d']], key=lambda x: x['d'])
def info(tid):
    r = [0, 0, 0]; loc = [0, 0, 0]; vis = [0, 0, 0]; gf = ga = 0; f = ''
    ms = [x for x in played if tid in (x['h'], x['a'])]
    for x in ms:
        h = x['h'] == tid; a, b = (x['hs'], x['as']) if h else (x['as'], x['hs']); gf += a; ga += b
        i = 0 if a > b else 1 if a == b else 2; r[i] += 1; (loc if h else vis)[i] += 1; f += 'GEP'[i]
    n = len(ms) or 1
    return dict(pts=3 * r[0] + r[1], rec='-'.join(map(str, r)), gf=f'{gf/n:.1f}', ga=f'{ga/n:.1f}', loc='-'.join(map(str, loc)), vis='-'.join(map(str, vis)), f=f[-5:])
ih, ia = info(m['h']), info(m['a'])
row = lambda a, lab, b: f'<tr><td><b>{a}</b></td><td>{lab}</td><td><b>{b}</b></td></tr>\n   '
tbl = (f'<tr><td>{H["ab"]}</td><td></td><td>{AW["ab"]}</td></tr>\n   ' + row(ih['pts'], 'Puntos', ia['pts']) + row(ih['rec'], 'Récord (G-E-P)', ia['rec'])
       + row(ih['gf'], 'Goles por partido', ia['gf']) + row(ih['ga'], 'Recibe por partido', ia['ga'])
       + row(ih['loc'], f'{H["name"]} de local / {AW["name"]} de visita', ia['vis']))
pill = lambda f: ''.join(f'<span class="{c}">{c}</span>' for c in f)
l5 = f'<div><div class="t">{H["name"]}</div><div class="pills">{pill(ih["f"])}</div></div><div><div class="t">{AW["name"]}</div><div class="pills">{pill(ia["f"])}</div></div>'
h2h = [x for x in played if {x['h'], x['a']} == {m['h'], m['a']}]
h2h = '<br>'.join(f'J{x["r"]} · {T[str(x["h"])]["name"]} <b style="font-family:Barlow Condensed;font-size:24px">{x["hs"]}–{x["as"]}</b> {T[str(x["a"])]["name"]}' for x in h2h) or 'Primer enfrentamiento del torneo'
def capcol(name, side):
    b = B.get(side, {}); out = ''
    for s in b.get('suspendidos', []): out += f'<div style="margin-top:6px"><span class="chip" style="background:#FF5A6E;color:#2A0006">Suspendido</span>{s}</div>'
    for c in b.get('capilla', []): out += f'<div style="margin-top:6px"><span class="chip">4 amarillas</span>{c}</div>'
    return f'<div><div class="t">{name}</div>{out or "<div class=mute>Sin bajas ni jugadores en capilla</div>"}</div>'
cap = capcol(H['name'], 'local') + capcol(AW['name'], 'visita')
dts = ''.join(f'<span><i class="dot {c}"></i> DT {L[s]["dt"]}</span>' for s, c in (('home', 'dh'), ('away', 'da')) if L[s].get('dt'))
hc, ht = COL.get(H['name'], ('#48C186', '#06130C')); ac, at = COL.get(AW['name'], ('#F4F4F0', '#141A16'))
s = open(os.path.join(R, 'previa.html'), encoding='utf-8').read()
for a, b in {'__DATA__': json.dumps({'home': L['home'], 'away': L['away']}, ensure_ascii=False), '__HC__': hc, '__HT__': ht, '__AC__': ac, '__AT__': at,
             '__J__': str(m['r']), '__HL__': logo(H), '__AL__': logo(AW), '__HN__': H['name'], '__AN__': AW['name'], '__SUB__': sub,
             '__HF__': L['home'].get('formation', ''), '__AF__': L['away'].get('formation', ''), '__DTS__': dts, '__CAP__': cap,
             '__TBL__': tbl, '__L5__': l5, '__H2H__': h2h}.items():
    s = s.replace(a, b)
tmp = os.path.join(R, f'_previa_{MID}.html'); open(tmp, 'w', encoding='utf-8').write(s)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={'width': 1080, 'height': 1350})
    pg.goto('file://' + tmp); pg.wait_for_timeout(2500); pg.screenshot(path=OUT); br.close()
os.remove(tmp); print(OUT)
