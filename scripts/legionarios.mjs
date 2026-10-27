// Legionarios: partidos de sus clubes, resultados y estadísticas de temporada.
// Corre lunes y jueves y gasta como máximo LEGIO_BUDGET consultas (45 por defecto, para el plan gratis).
// Lo que no alcanza a bajar hoy, lo completa en las corridas siguientes.
// Uso: HIGHLIGHTLY_KEY=... node scripts/legionarios.mjs

import fs from 'node:fs/promises';

const KEY = process.env.HIGHLIGHTLY_KEY;
if (!KEY) { console.error('Falta HIGHLIGHTLY_KEY'); process.exit(1); }
const BASE = 'https://soccer.highlightly.net';
const OUT = 'public/data/legionarios.json';
let budget = Number(process.env.LEGIO_BUDGET || 45);
const log = [];
const say = s => { log.push(s); console.log(s); };

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const fixText = s => (typeof s === 'string' && /[ÃÂ]/.test(s)) ? (() => { try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; } })() : s;
const isFinal = s => /finish|award|after|penalt/i.test(s || '');

class OutOfBudget extends Error {}
let remaining = null;
async function api(path) {
  if (budget <= 0) throw new OutOfBudget();
  budget--;
  const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': KEY } });
  remaining = r.headers.get('x-ratelimit-requests-remaining') ?? remaining;
  if (r.status === 429) { budget = 0; throw new OutOfBudget(); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

async function main() {
  const cfg = JSON.parse(await fs.readFile('data/legionarios.json', 'utf8'));
  const season = cfg.temporada;
  let old = {};
  try { old = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera vez */ }
  const oldByName = new Map((old.players || []).map(p => [p.nombre, p]));
  const clubs = old.clubs || {};
  const now = Date.now();

  // La lista manda: nombre, club, posición; de la corrida anterior se conservan ids y estadísticas
  const players = cfg.jugadores.map(j => {
    const o = oldByName.get(j.nombre) || {};
    const clave = [].concat(j.buscar).join('|');
    const sameClub = o.club === j.club && o.clave === clave;
    return { ...j, clave, teamId: j.teamId ?? (sameClub ? o.teamId : undefined), playerId: j.playerId ?? o.playerId,
      stats: sameClub ? o.stats : undefined, statsAt: sameClub ? o.statsAt : undefined };
  });

  const skip = new Set((old.skipTeams || []).map(String));
  try {
    // 1) Identificar cada club en la API (una sola vez). La búsqueda de Highlightly es por nombre exacto,
    //    así que "buscar" puede ser una lista de variantes; se prueba una por una hasta encontrarlo.
    for (const p of players) {
      if (p.teamId) continue;
      const names = [].concat(p.buscar);
      const known = players.find(x => x !== p && x.teamId && x.clave === p.clave);
      if (known) { p.teamId = known.teamId; continue; }
      let pick = null;
      for (const name of names) {
        const res = (await api(`/teams?name=${encodeURIComponent(name)}&limit=20`))?.data || [];
        const youth = t => /women|femen|\bW$|\bU\d\d\b/i.test(t.name) && !/women|\bU\d\d\b/i.test(name);
        const cands = res.filter(t => !skip.has(String(t.id)) && !/national/i.test(t.type || '') && !youth(t));
        const inCountry = p.paisApi ? cands.filter(t => norm(t.country?.name) === norm(p.paisApi)) : [];
        const pool = inCountry.length ? inCountry : cands;
        pick = pool.find(t => norm(t.name) === norm(name)) || pool[0] || null;
        if (res.length > 1) say(`"${name}": ${res.slice(0, 6).map(t => `${t.name}${t.country?.name ? ' [' + t.country.name + ']' : ''} (${t.id})`).join(', ')}`);
        if (pick) break;
      }
      if (!pick) { say(`Sin club en la API para ${names.map(n => `"${n}"`).join(' / ')} (${p.nombre})`); continue; }
      p.teamId = pick.id;
      clubs[pick.id] = { ...(clubs[pick.id] || {}), name: pick.name, logo: pick.logo || null };
    }

    // 2) Resultados: partidos ya jugados de los que todavía no tenemos el marcador final
    const pending = [];
    for (const [tid, c] of Object.entries(clubs)) for (const m of c.fixtures || []) {
      const k = new Date(m.d).getTime();
      if (!isFinal(m.s) && now > k + 2 * 3600e3 && now < k + 10 * 864e5) pending.push([tid, m]);
    }
    for (const [, m] of pending) {
      const raw = await api(`/matches/${m.id}`);
      const x = Array.isArray(raw) ? raw[0] : raw;
      if (!x) continue;
      m.s = x.state?.description; m.score = x.state?.score?.current || null;
      m.ev = (x.events || []).filter(e => /goal|penalty|card|substitution/i.test(e.type || ''))
        .map(e => ({ t: String(e.time), type: e.type, team: e.team?.id, player: fixText(e.player), sub: fixText(e.substituted), assist: fixText(e.assist) }));
    }

    // 3) Calendario de cada club (el más viejo primero; se renueva cada 5 días)
    const clubIds = [...new Set(players.map(p => p.teamId).filter(Boolean))]
      .sort((a, b) => (clubs[a]?.fixturesAt ? Date.parse(clubs[a].fixturesAt) : 0) - (clubs[b]?.fixturesAt ? Date.parse(clubs[b].fixturesAt) : 0));
    for (const tid of clubIds) {
      const c = clubs[tid] ||= {};
      if (c.fixturesAt && now - Date.parse(c.fixturesAt) < 5 * 864e5) continue;
      const got = [];
      for (const side of ['homeTeamId', 'awayTeamId']) {
        const page = await api(`/matches?${side}=${tid}&season=${season}&timezone=America/Costa_Rica&limit=100`);
        got.push(...(page?.data || []));
      }
      const prev = new Map((c.fixtures || []).map(m => [m.id, m]));
      c.fixtures = got.map(x => {
        const p0 = prev.get(x.id) || {};
        return { id: x.id, d: x.date, comp: x.league?.name, round: x.round, s: x.state?.description, score: x.state?.score?.current || null,
          h: { id: x.homeTeam?.id, name: x.homeTeam?.name, logo: x.homeTeam?.logo }, a: { id: x.awayTeam?.id, name: x.awayTeam?.name, logo: x.awayTeam?.logo },
          ev: p0.ev };
      }).sort((a, b) => new Date(a.d) - new Date(b.d));
      c.fixturesAt = new Date().toISOString();
      if (!c.name) { const m = got[0]; const t = m && (m.homeTeam?.id == tid ? m.homeTeam : m.awayTeam); if (t) { c.name = t.name; c.logo = t.logo || null; } }
      if (!got.length) {
        // club equivocado (o sin calendario): se descarta y en la próxima corrida se prueba otra opción
        say(`Sin partidos de la temporada ${season} para el club ${c.name || tid}`);
        const manual = cfg.jugadores.some(j => j.teamId == tid);
        if (!manual) {
          skip.add(String(tid)); delete clubs[tid];
          for (const p of players) if (p.teamId == tid) { p.teamId = undefined; p.playerId = undefined; }
        }
      }
    }

    // 4) Identificar a cada jugador (una sola vez): buscar por nombre y confirmar con su club
    for (const p of players) {
      if (p.playerId || !p.teamId) continue;
      const q = norm(p.nombre);
      const res = (await api(`/players?name=${encodeURIComponent(q)}&limit=10`))?.data || [];
      const clubName = norm(clubs[p.teamId]?.name || p.club);
      let pick = null;
      for (const cand of res.slice(0, 3)) {
        const st = await api(`/players/${cand.id}/statistics`);
        const s0 = Array.isArray(st) ? st[0] : st;
        const clubsOf = [...(s0?.perClub || []).map(c => c.club || c.name), ...(s0?.perCompetition || []).map(c => c.club)].map(norm);
        if (clubsOf.some(c => c && (c.includes(clubName) || clubName.includes(c)))) { pick = cand; p.stats = summarize(s0, clubName, season); p.statsAt = new Date().toISOString(); break; }
      }
      if (pick) { p.playerId = pick.id; p.foto = pick.logo || null; }
      else say(`No pude confirmar a ${p.nombre} en ${clubs[p.teamId]?.name || p.club} (${res.length} resultados)`);
    }

    // 5) Estadísticas de temporada: primero quien jugó desde la última vez
    const lastPlayed = tid => Math.max(0, ...((clubs[tid]?.fixtures || []).filter(m => isFinal(m.s)).map(m => Date.parse(m.d))));
    const due = players.filter(p => p.playerId && (!p.statsAt || lastPlayed(p.teamId) > Date.parse(p.statsAt) || now - Date.parse(p.statsAt) > 7 * 864e5))
      .sort((a, b) => (a.statsAt ? Date.parse(a.statsAt) : 0) - (b.statsAt ? Date.parse(b.statsAt) : 0));
    for (const p of due) {
      const st = await api(`/players/${p.playerId}/statistics`);
      const s0 = Array.isArray(st) ? st[0] : st;
      if (s0) { p.stats = summarize(s0, norm(clubs[p.teamId]?.name || p.club), season); p.statsAt = new Date().toISOString(); if (!p.foto && s0.logo) p.foto = s0.logo; }
    }
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    say('Se usó todo el presupuesto de hoy; mañana sigue.');
  }

  // Los ids nuevos se guardan en el archivo de salida (la lista que editás no se toca)
  const out = { updated: new Date().toISOString(), season, players: players.map(({ buscar, paisApi, ...p }) => p), clubs, skipTeams: [...skip], log };
  await fs.mkdir('public/data', { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`Listo. Consultas de la API restantes hoy: ${remaining}.`);
}

// Suma las competencias de la temporada actual con su club actual
function summarize(s0, clubName, season) {
  const rows = (s0?.perCompetition || []).filter(c => String(c.season || '').includes(String(season)) || String(c.season || '').includes(String(season - 1) + '/' + String(season).slice(2)));
  const mine = rows.filter(c => !clubName || norm(c.club).includes(clubName) || clubName.includes(norm(c.club)));
  const use = mine.length ? mine : rows;
  const sum = k => use.reduce((a, c) => a + (Number(c[k]) || 0), 0);
  return { games: sum('gamesPlayed'), goals: sum('goals'), assists: sum('assists'), minutes: sum('minutesPlayed'), yc: sum('yellowCards'), rc: sum('redCards'),
    cleanSheets: sum('cleanSheets'), conceded: sum('goalsConceded'), comps: use.map(c => ({ league: c.league, season: c.season, games: c.gamesPlayed, goals: c.goals })) };
}

main().catch(e => { console.error(e.message); process.exit(1); });
