// Solo consulta: ¿qué estadísticas trae la API de la Liga tica? No guarda nada ni toca la página.
import fs from 'node:fs';
const KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = 'https://soccer.highlightly.net';
const api = async p => { const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': KEY } }); console.log(`[${r.status}] ${p}`); return r.ok ? r.json() : null; };
const out = (t, x, n = 2500) => console.log(`== ${t}:`, JSON.stringify(x).slice(0, n));
const D = JSON.parse(fs.readFileSync('public/data/season.json', 'utf8'));
const P = D.matches.filter(m => m.hs !== undefined);
// 1) estadísticas de partido: cobertura en todos los jugados
let withSt = 0; const names = {};
for (const m of P) {
  const raw = await api(`/matches/${m.id}`); const x = Array.isArray(raw) ? raw[0] : raw;
  const st = x?.statistics || [];
  if (st.length) { withSt++; for (const t of st) for (const s of t.statistics || []) names[s.displayName] = (names[s.displayName] || 0) + 1; }
  if (m === P[P.length - 1]) { out('partido crudo (claves)', Object.keys(x || {})); out('statistics', st, 3000); out('otras', { venue: x?.venue, referee: x?.referee, forecast: x?.forecast, predictions: x?.predictions, shots: x?.shots }, 1500); }
}
console.log(`\nPartidos con estadísticas: ${withSt} de ${P.length}`); console.log('Campos y en cuántos equipos-partido:', names);
// 2) estadísticas de jugador (goleadores)
for (const id of [5778122, 2232097, 458199]) { const r = await api(`/players/${id}/statistics`); out(`jugador ${id}`, r, 2500); }
// 3) estadísticas de equipo
const tid = Object.keys(D.teams)[0];
for (const p of [`/teams/statistics/${tid}?fromDate=2026-07-01`, `/teams/${tid}/statistics`, `/teams/statistics/${tid}?leagueId=138646&season=2026`]) { const r = await api(p); out(p, r, 2500); }
// 4) tabla
const s = await api(`/standings?leagueId=138646&season=2026`); out('tabla', s, 1500);
// 5) lineups / box score de un partido
const r = await api(`/lineups/${P[P.length - 1].id}`); out('lineups', r, 800);
const b = await api(`/box-score/${P[P.length - 1].id}`); out('box-score', b, 2500);
