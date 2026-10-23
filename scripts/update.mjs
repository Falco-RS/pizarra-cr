// Descarga los datos del torneo desde Highlightly y los guarda en public/data/season.json.
// Reutiliza lo que ya está guardado: solo pide a la API lo nuevo (partidos recién terminados).
// Uso: HIGHLIGHTLY_KEY=tu_llave node scripts/update.mjs

import fs from 'node:fs/promises';

const KEY = process.env.HIGHLIGHTLY_KEY;
if (!KEY) { console.error('Falta la variable HIGHLIGHTLY_KEY'); process.exit(1); }

const BASE = 'https://soccer.highlightly.net';
const OUT = 'public/data/season.json';
const CORRECTIONS = 'data/correcciones.json';
const LEAGUE_ID = Number(process.env.LEAGUE_ID || 138646);   // Primera División de Costa Rica
const SEASON = Number(process.env.SEASON || 2026);
const MAX_NEW = Number(process.env.MAX_NEW_PER_RUN || 20);   // tope de consultas extra por corrida
// Torneos internacionales donde juegan equipos ticos (se filtran por equipo)
const INTL = (process.env.INTL_LEAGUES || 'Concacaf Central American Cup,CONCACAF Champions Cup')
  .split(',').map(s => s.trim()).filter(Boolean);

const SHORT = {
  'Deportivo Saprissa': ['Saprissa', 'SAP'], 'LD Alajuelense': ['Alajuelense', 'LDA'],
  'CS Herediano': ['Herediano', 'HER'], 'CS Cartaginés': ['Cartaginés', 'CAR'],
  'Sporting San Jose': ['Sporting', 'SPO'], 'Perez Zeledon': ['Pérez Zeledón', 'PZ'],
  'Puntarenas FC': ['Puntarenas', 'PUN'], 'Inter San Carlos': ['Inter San Carlos', 'ISC'],
  'San Carlos': ['San Carlos', 'SCA'], 'Escorpiones Belén': ['Escorpiones Belén', 'ESC'],
  'Municipal Liberia': ['Liberia', 'LIB'], 'AD Guanacasteca': ['Guanacasteca', 'GUA'],
};
const TYPE = {
  'Goal': 'goal', 'Penalty': 'pen', 'Own Goal': 'og', 'Yellow Card': 'yc', 'Red Card': 'rc',
  'Substitution': 'sub', 'Missed Penalty': 'mp', 'VAR Goal Cancelled': 'var',
};

let used = 0, remaining = null, limited = false;
class LimitError extends Error {}
async function api(path) {
  used++;
  const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': KEY } });
  remaining = r.headers.get('x-ratelimit-requests-remaining') ?? remaining;
  if (r.status === 404) return null;
  if (r.status === 429) { limited = true; throw new LimitError('Se acabaron las consultas del día'); }
  if (!r.ok) throw new Error(`${r.status} en ${path}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Algunos nombres llegan con acentos mal codificados ("Ã\u0081lvarez")
function fixText(s) {
  if (typeof s !== 'string' || !/[ÃÂ]/.test(s)) return s;
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
}
const fixDeep = o => Array.isArray(o) ? o.map(fixDeep)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fixDeep(v)]))
  : fixText(o);

const isFinal = s => /finish|award/i.test(s || '');
const team = t => {
  const clean = t.name.replace(/^(CD|CS|LD|AD|FC|CF|SD|Club|Deportivo)\s+/i, '').replace(/\s+(FC|CF)$/i, '');
  const [name, ab] = SHORT[t.name] || [clean, clean.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase()];
  return { name, full: t.name, ab, logo: t.logo || null };
};
const compactEvents = (ev, homeId) => (ev || []).map(e => [String(e.time), TYPE[e.type] || e.type, e.team?.id === homeId ? 1 : 0, fixText(e.player), fixText(e.substituted)]);

async function allMatches(query) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api(`/matches?${query}&timezone=America/Costa_Rica&limit=100&offset=${offset}`);
    const data = page?.data || [];
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

async function main() {
  let old = { matches: [], detail: {} };
  try { old = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera corrida */ }
  const oldById = new Map((old.matches || []).map(m => [m.id, m]));
  let mesa = {};
  try { mesa = JSON.parse(await fs.readFile(CORRECTIONS, 'utf8')); } catch { /* sin correcciones */ }

  // 1) Partidos del torneo
  let raw;
  try { raw = await allMatches(`leagueId=${LEAGUE_ID}&season=${SEASON}`); }
  catch (e) {
    if (e instanceof LimitError) { console.log('Se acabaron las consultas del día. Los datos quedan como estaban; la próxima corrida sigue.'); return; }
    throw e;
  }
  if (!raw.length) throw new Error('La API no devolvió partidos. Revisá LEAGUE_ID y SEASON.');
  const teams = {};
  for (const m of raw) for (const k of ['homeTeam', 'awayTeam']) teams[m[k].id] = team(m[k]);

  let budget = MAX_NEW;
  const detail = { ...(old.detail || {}) };
  const matches = [];
  // Primero los más recientes, para que el presupuesto se gaste en lo nuevo
  const sorted = raw.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const m of sorted) {
    const sc = m.state?.score?.current;
    const rec = { id: m.id, r: Number(String(m.round).split('-').pop()) || null, round: m.round, d: m.date, h: m.homeTeam.id, a: m.awayTeam.id, s: m.state?.description };
    if (sc && isFinal(rec.s)) {
      [rec.hs, rec.as] = sc.split(' - ').map(Number);
      const prev = oldById.get(m.id);
      if (prev?.ev && isFinal(prev.s)) rec.ev = prev.ev;
      else if (budget > 0 && !limited) {
        budget--;
        try { rec.ev = compactEvents(await api(`/events/${m.id}`), m.homeTeam.id); }
        catch (e) { if (!(e instanceof LimitError)) throw e; }
      }
      if (!detail[m.id] && budget >= 2 && !limited && rec.s !== 'Awarded') {
        budget -= 2;
        let lu = null, st = null;
        try { lu = await api(`/lineups/${m.id}`); st = await api(`/statistics/${m.id}`); }
        catch (e) { if (!(e instanceof LimitError)) throw e; }
        if (lu && st) {
          const side = t => ({ f: t.formation, xi: (t.initialLineup || []).flat().map(p => ({ n: p.number, name: fixText(p.name), pos: p.position })) });
          detail[m.id] = {
            lineups: { h: side(lu.homeTeam), a: side(lu.awayTeam) },
            stats: st.map(t => Object.fromEntries(t.statistics.map(s => [s.displayName, s.value]))),
            statsTeams: st.map(t => t.team.id),
          };
        }
      }
    }
    matches.push(rec);
  }

  // 2) Tabla oficial
  let sd = null;
  if (!limited) { try { sd = await api(`/standings?leagueId=${LEAGUE_ID}&season=${SEASON}`); } catch (e) { if (!(e instanceof LimitError)) throw e; } }
  const standings = !sd ? (old.standings || []) : (sd.groups?.[0]?.standings || []).map(s => ({ t: s.team.id, pos: s.position, pts: s.points, total: s.total, home: s.home, away: s.away }));

  // 3) Internacionales con equipos ticos
  const ids = new Set(Object.keys(teams).map(Number));
  let intl = [];
  for (const name of INTL) {
    if (limited) break;
    try {
      const list = await allMatches(`leagueName=${encodeURIComponent(name)}&season=${SEASON}`);
      for (const m of list) {
        if (!ids.has(m.homeTeam.id) && !ids.has(m.awayTeam.id)) continue;
        const sc = m.state?.score?.current;
        const rec = { id: m.id, comp: m.league?.name || name, leagueId: m.league?.id, round: m.round, d: m.date, s: m.state?.description, h: team(m.homeTeam), a: team(m.awayTeam), hId: m.homeTeam.id, aId: m.awayTeam.id };
        if (sc) [rec.hs, rec.as] = sc.split(' - ').map(Number);
        intl.push(rec);
      }
    } catch (e) { console.warn(`No se pudo leer ${name}: ${e.message}`); }
  }
  if (limited && !intl.length) intl = old.intl || [];
  intl.sort((a, b) => new Date(a.d) - new Date(b.d));

  const out = fixDeep({
    updated: new Date().toISOString(),
    league: { id: LEAGUE_ID, name: 'Primera División', season: SEASON },
    teams, matches, standings, detail, intl, mesa,
  });
  await fs.mkdir('public/data', { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  const pending = matches.filter(m => m.hs !== undefined && !m.ev).length;
  console.log(`Listo: ${matches.length} partidos, ${intl.length} internacionales. Consultas usadas: ${used}. Quedan hoy: ${remaining}.${limited ? ' Se llegó al límite diario; se guardó lo que se alcanzó a bajar.' : ''}${pending ? ` Faltan ${pending} partidos por completar en la próxima corrida.` : ''}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
