// Liga de Ascenso: datos de la API para las previas de los playoffs (public/data/ascenso-api.json).
// Trae todos los partidos del torneo, y para cada serie de public/data/ascenso.json:
// el historial entre los dos equipos y, si la API ya los publicó, los partidos de la serie (para marcador y en vivo).
// Uso: HIGHLIGHTLY_KEY=... node scripts/ascenso.mjs

import fs from 'node:fs/promises';

const KEY = process.env.HIGHLIGHTLY_KEY;
if (!KEY) { console.error('Falta HIGHLIGHTLY_KEY'); process.exit(1); }
const BASE = 'https://soccer.highlightly.net';
const LEAGUE = Number(process.env.ASCENSO_LEAGUE || 139497);
const SEASON = Number(process.env.SEASON || 2026);
let used = 0, remaining = null;
async function api(path) {
  used++;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': KEY } });
    remaining = r.headers.get('x-ratelimit-requests-remaining') ?? remaining;
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 2000)); continue; }
    if (!r.ok) { console.log(`[${r.status}] ${path}`); return null; }
    return r.json();
  }
  return null;
}
const fixText = s => (typeof s === 'string' && /[ÃÂ]/.test(s)) ? (() => { try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; } })() : s;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isFinal = s => /finish|award|after|penalt/i.test(s || '');
const slim = x => {
  const sc = x.state?.score?.current;
  const o = { id: x.id, d: x.date, r: x.round, s: x.state?.description, lg: x.league?.name,
    h: { id: x.homeTeam?.id, n: fixText(x.homeTeam?.name) }, a: { id: x.awayTeam?.id, n: fixText(x.awayTeam?.name) } };
  if (sc && (isFinal(o.s) || /half|progress|live|break/i.test(o.s || ''))) [o.hs, o.as] = sc.split(' - ').map(Number);
  if (x.state?.score?.penalties) o.pen = x.state.score.penalties;
  return o;
};

const cfg = JSON.parse(await fs.readFile('public/data/ascenso.json', 'utf8'));

// 1) todos los partidos del torneo (con paginación)
const all = new Map();
for (let off = 0; off < 1000; off += 100) {
  const p = await api(`/matches?leagueId=${LEAGUE}&season=${SEASON}&limit=100&offset=${off}`);
  const list = p?.data || [];
  for (const x of list) all.set(x.id, slim(x));
  if (list.length < 100) break;
}
const matches = [...all.values()].sort((a, b) => new Date(a.d) - new Date(b.d));
const teams = new Map();
for (const m of matches) for (const t of [m.h, m.a]) if (t.id) teams.set(t.id, t.n);
console.log(`Partidos: ${matches.length} · equipos: ${teams.size}`);
console.log('Equipos en la API:', [...teams.entries()].map(([id, n]) => `${n} (${id})`).join(', '));
console.log('Rondas:', [...new Set(matches.map(m => m.r))].join(' | '));

// 2) cada equipo de la serie -> id de la API (por nombre; se puede fijar a mano con "apiId" en ascenso.json)
const PISTAS = { guadalupe: ['guadalupe'], jicaral: ['jicaral'], cariari: ['cariari', 'pococi'], grecia: ['grecia'], rosario: ['rosario'],
  pitbulls: ['pitbull', 'santa barbara'], sarchi: ['sarchi'], santaana: ['santa ana'] };
const ids = {};
for (const [k, e] of Object.entries(cfg.equipos || {})) {
  if (e.apiId) { ids[k] = e.apiId; continue; }
  const pistas = PISTAS[k] || [norm(e.nombre)];
  const hit = [...teams.entries()].find(([, n]) => pistas.some(p => norm(n).includes(p)));
  if (hit) ids[k] = hit[0];
  console.log(`  ${e.nombre} -> ${hit ? hit[1] + ' (' + hit[0] + ')' : 'NO ENCONTRADO'}`);
}

// 3) por serie: historial entre los dos y partidos de la serie si ya existen
const series = {};
for (const s of cfg.series || []) {
  const A = ids[s.a], B = ids[s.b];
  if (!A || !B) continue;
  const h = await api(`/head-2-head?teamIdOne=${A}&teamIdTwo=${B}`);
  const h2h = (Array.isArray(h) ? h : h?.data || []).map(slim).filter(m => m.hs !== undefined).sort((a, b) => new Date(b.d) - new Date(a.d)).slice(0, 10);
  const now = Date.now();
  const legs = matches.filter(m => ((m.h.id === A && m.a.id === B) || (m.h.id === B && m.a.id === A)) && new Date(m.d).getTime() > now - 30 * 864e5 && new Date(m.d) >= new Date('2026-11-01'));
  series[s.n] = { a: A, b: B, h2h, legs };
  console.log(`Serie ${s.n}: historial ${h2h.length} partidos · partidos de la serie en la API: ${legs.length}`);
}

await fs.writeFile('public/data/ascenso-api.json', JSON.stringify({ updated: new Date().toISOString(), ids, series, matches }));
console.log(`Listo. Consultas: ${used} · restantes hoy: ${remaining}`);
