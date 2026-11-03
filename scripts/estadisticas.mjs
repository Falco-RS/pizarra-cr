// Estadísticas extra para la pestaña "Estadísticas" (public/data/estadisticas.json):
//  - por partido: posesión, remates, tiros de esquina, fueras de juego, etc. (solo se pide una vez por partido)
//  - por jugador: asistencias, minutos, partidos, penales... (de /players/{id}/statistics, se refresca cada corrida)
//  - nombres completos de los jugadores ("R. Cisneros" -> "Ronaldo Cisneros")
// Uso: HIGHLIGHTLY_KEY=... node scripts/estadisticas.mjs

import fs from 'node:fs/promises';

const KEY = process.env.HIGHLIGHTLY_KEY;
if (!KEY) { console.error('Falta HIGHLIGHTLY_KEY'); process.exit(1); }
const BASE = 'https://soccer.highlightly.net';
const OUT = 'public/data/estadisticas.json';
let budget = Number(process.env.STATS_BUDGET || 900);
let remaining = null, used = 0;

async function api(path) {
  if (budget-- <= 0) throw new Error('presupuesto');
  used++;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': KEY } });
    remaining = r.headers.get('x-ratelimit-requests-remaining') ?? remaining;
    if (r.status === 404) return null;
    if (r.status === 429) { await new Promise(s => setTimeout(s, 3000)); continue; }
    if (!r.ok) { console.log(`[${r.status}] ${path}`); return null; }
    return r.json();
  }
  return null;
}
const one = x => Array.isArray(x) ? x[0] : x;
const fixText = s => (typeof s === 'string' && /[ÃÂ]/.test(s)) ? (() => { try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; } })() : s;

const D = JSON.parse(await fs.readFile('public/data/season.json', 'utf8'));
let old = {};
try { old = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera vez */ }
const played = D.matches.filter(m => m.hs !== undefined);

/* 1) Estadísticas de cada partido + jugadores que aparecen en el minuto a minuto */
const KEYS = { 'Possession': 'pos', 'Shots on target': 'son', 'Shots off target': 'soff', 'Blocked shots': 'sblk', 'Corners': 'cor',
  'Offsides': 'off', 'Attacks': 'atk', 'Free Kicks': 'fk', 'Goal Kicks': 'gk', 'Throw-Ins': 'thr' };
const matches = old.matches || {};
const seen = new Map(Object.entries(old.seen || {}));   // playerId -> { n: abreviado, t: equipo }
let fetched = 0;
for (const m of played) {
  if (matches[m.id] && old.seenFrom?.includes(m.id)) continue;
  const x = one(await api(`/matches/${m.id}`));
  if (!x) continue;
  fetched++;
  const st = x.statistics || [];
  if (st.length === 2) {
    const pick = t => Object.fromEntries((t.statistics || []).filter(s => KEYS[s.displayName]).map(s => [KEYS[s.displayName], s.value]));
    const h = st.find(t => t.team?.id === m.h) || st[0], a = st.find(t => t.team?.id === m.a) || st[1];
    matches[m.id] = { h: pick(h), a: pick(a) };
  } else matches[m.id] = matches[m.id] || null;
  for (const e of x.events || []) {
    const t = e.team?.id;
    if (e.playerId && e.player) seen.set(String(e.playerId), { n: fixText(e.player), t });
    for (const [k, v] of Object.entries(e)) if (/Id$/.test(k) && k !== 'playerId' && v && typeof v === 'number') {
      const nk = k.replace(/Id$/, '').replace(/^(substituted|assisting)Player$/, '$1');
      const nm = e[nk] || e[k.replace(/PlayerId$/, '')] || (k === 'substitutedPlayerId' ? e.substituted : null);
      if (nm) seen.set(String(v), { n: fixText(nm), t });
    }
  }
  (old.seenFrom ||= []).push(m.id);
}
console.log(`Partidos consultados: ${fetched} · jugadores conocidos: ${seen.size}`);

/* 2) Plantillas completas, si la API las da (así aparecen también los que nunca salen en el minuto a minuto) */
for (const tid of Object.keys(D.teams)) {
  const r = await api(`/players?teamId=${tid}&limit=100`);
  const list = r?.data || (Array.isArray(r) ? r : []);
  for (const p of list) if (p.id && !seen.has(String(p.id))) seen.set(String(p.id), { n: fixText(p.name), t: +tid });
  if (tid === Object.keys(D.teams)[0]) console.log(`Plantilla por equipo: ${list.length ? 'sí (' + list.length + ')' : 'no'}`);
  if (!list.length) break;   // si la API no lo soporta, no gastar más
}

/* 3) Números de cada jugador en el torneo */
const COMPOUND = new Set(['juan', 'jose', 'josé', 'luis', 'carlos', 'jean', 'marco', 'miguel', 'pedro', 'jorge', 'john', 'ana', 'maria', 'maría']);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function display(abbr, short, full) {
  // la API da "Andrey Soto" (bien), "R. Cisneros" (abreviado) y "Ronaldo Cisneros Morell" (completo)
  if (short && !/^[A-Z]\.\s/.test(short) && short.split(' ').length <= 3) return short;
  if (!full) return null;
  const f = full.split(/\s+/), base = (short || abbr || '').replace(/^[A-Z]\.\s*/, '').split(/\s+/)[0];
  const i = f.findIndex((w, k) => k > 0 && norm(w) === norm(base));
  if (i > 0) {
    const given = f.slice(0, i);
    const g = given.length > 1 && COMPOUND.has(norm(given[0])) ? given.slice(0, 2) : given.slice(0, 1);
    return [...g, f[i]].join(' ');
  }
  return f.length <= 2 ? full : `${f[0]} ${f[f.length - 2]}`;
}
const players = [];
const seasonRank = s => { const m = String(s).match(/(\d{2})\/(\d{2})/); return m ? +m[1] : (+String(s).slice(-2) || 0); };
for (const [id, info] of seen) {
  const r = one(await api(`/players/${id}/statistics`));
  if (!r) { players.push({ id: +id, t: info.t, abbr: info.n }); continue; }
  const comps = (r.perCompetition || []).filter(c => /^Primera Divisi[oó]n (Apertura|Clausura)$/.test(c.league || ''));
  comps.sort((a, b) => seasonRank(b.season) - seasonRank(a.season) || (/Clausura/.test(b.league) - /Clausura/.test(a.league)));
  const c = comps[0] && seasonRank(comps[0].season) >= 26 ? comps[0] : null;
  players.push({
    id: +id, t: info.t, abbr: info.n, name: display(info.n, fixText(r.name), fixText(r.fullName)), full: fixText(r.fullName) || null,
    ...(c ? { torneo: `${c.league} ${c.season}`, pj: c.gamesPlayed, min: c.minutesPlayed, g: c.goals, a: c.assists, pen: c.penaltiesScored,
      yc: c.yellowCards, rc: c.redCards, sin: c.substitutedIn, sout: c.substitutedOut, cs: c.cleanSheets, gc: c.goalsConceded, og: c.ownGoals } : {}),
  });
}
const names = {};
for (const p of players) if (p.name && p.abbr) names[`${p.t}|${p.abbr}`] = p.name;
console.log(`Jugadores: ${players.length} · con nombre completo: ${players.filter(p => p.name).length} · con números del torneo: ${players.filter(p => p.pj !== undefined).length}`);
console.log('Asistidores:', players.filter(p => p.a).sort((a, b) => b.a - a.a).slice(0, 12).map(p => `${p.name || p.abbr} ${p.a}`).join(', '));

await fs.writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), matches, players, names, seen: Object.fromEntries(seen), seenFrom: old.seenFrom }));
console.log(`Listo. Consultas usadas: ${used} · restantes hoy: ${remaining}`);
