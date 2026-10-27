// La Sele: partidos de la Selección de Costa Rica (próximos y últimos) con el minuto a minuto de los jugados.
// Se corre A MANO (GitHub → Actions → "La Sele" → Run workflow) porque la Sele juega pocas veces al año:
// por ejemplo, después de cada fecha FIFA. Gasta unas 10-15 consultas.
// Uso: HIGHLIGHTLY_KEY=... node scripts/sele.mjs

import fs from 'node:fs/promises';

const KEY = process.env.HIGHLIGHTLY_KEY;
if (!KEY) { console.error('Falta HIGHLIGHTLY_KEY'); process.exit(1); }
const BASE = 'https://soccer.highlightly.net';
const OUT = 'public/data/sele.json';
let budget = Number(process.env.SELE_BUDGET || 15);
const TYPE = { 'Goal': 'goal', 'Penalty': 'pen', 'Own Goal': 'og', 'Yellow Card': 'yc', 'Red Card': 'rc', 'Substitution': 'sub', 'Missed Penalty': 'mp', 'VAR Goal Cancelled': 'var' };
const fixText = s => (typeof s === 'string' && /[ÃÂ]/.test(s)) ? (() => { try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; } })() : s;
const isFinal = s => /finish|award|after|penalt/i.test(s || '');

let remaining = null;
async function api(path) {
  if (budget-- <= 0) throw new Error('Se acabó el presupuesto de esta corrida');
  const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': KEY } });
  remaining = r.headers.get('x-ratelimit-requests-remaining') ?? remaining;
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

const cfg = JSON.parse(await fs.readFile('data/sele.json', 'utf8'));
let old = {};
try { old = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera vez */ }
const oldById = new Map((old.matches || []).map(m => [m.id, m]));

// 1) La selección en la API (una sola vez; después queda guardado en data/sele.json o en la salida)
let teamId = cfg.teamId || old.teamId;
if (!teamId) {
  const res = (await api(`/teams?name=${encodeURIComponent('Costa Rica')}&limit=20`))?.data || [];
  console.log('Opciones:', res.map(t => `${t.name} ${t.type || ''} (${t.id})`).join(', '));
  const pick = res.find(t => /national/i.test(t.type || '') && !/women|u\d\d/i.test(t.name)) || res.find(t => t.name === 'Costa Rica');
  if (!pick) { console.error('No encontré a Costa Rica en la API'); process.exit(1); }
  teamId = pick.id;
}

// 2) Partidos de este año y del anterior, de local y de visita
const year = new Date().getFullYear();
const got = new Map();
for (const season of [year, year - 1]) for (const side of ['homeTeamId', 'awayTeamId']) {
  const page = await api(`/matches?${side}=${teamId}&season=${season}&limit=100`);
  for (const x of page?.data || []) got.set(x.id, x);
}
const slimTeam = t => ({ id: t.id, name: fixText(t.name), logo: t.logo || null });
let matches = [...got.values()].map(x => {
  const o = oldById.get(x.id) || {};
  const sc = x.state?.score?.current;
  const rec = { id: x.id, d: x.date, comp: x.league?.name, round: x.round, s: x.state?.description, h: slimTeam(x.homeTeam), a: slimTeam(x.awayTeam) };
  if (sc && isFinal(rec.s)) [rec.hs, rec.as] = sc.split(' - ').map(Number);
  if (o.ev) { rec.ev = o.ev; rec.stats = o.stats; }
  return rec;
}).sort((a, b) => new Date(a.d) - new Date(b.d));

// 3) Minuto a minuto y estadísticas de los últimos jugados que todavía no lo tienen
const need = matches.filter(m => m.hs !== undefined && !m.ev).slice(-6).reverse();
for (const m of need) {
  if (budget <= 0) break;
  const raw = await api(`/matches/${m.id}`);
  const x = Array.isArray(raw) ? raw[0] : raw;
  if (!x) continue;
  m.ev = (x.events || []).map(e => [String(e.time), TYPE[e.type] || e.type, e.team?.id === m.h.id ? 1 : 0, fixText(e.player), fixText(e.substituted)]);
  const st = x.statistics || [];
  if (st.length === 2) m.stats = st.map(t => ({ t: t.team?.id, s: Object.fromEntries((t.statistics || []).map(s => [s.displayName, s.value])) }));
}

await fs.writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), teamId, staff: cfg.staff, proximos: cfg.proximos || [], matches }));
console.log(`Listo: ${matches.length} partidos (${matches.filter(m => m.hs === undefined).length} por jugar). Consultas restantes hoy: ${remaining}.`);
