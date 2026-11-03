// Solo consulta: ¿la API da el nombre completo de los jugadores de la Liga tica? No guarda nada ni toca la página.
import fs from 'node:fs';
const KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = 'https://soccer.highlightly.net';
const api = async p => { const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': KEY } }); return r.ok ? r.json() : (console.log(`[${r.status}] ${p}`), null); };
const D = JSON.parse(fs.readFileSync('public/data/season.json', 'utf8'));
const played = D.matches.filter(m => m.hs !== undefined).slice(-15);
const ids = new Map();
for (const m of played) {
  const raw = await api(`/matches/${m.id}`); const x = Array.isArray(raw) ? raw[0] : raw;
  for (const e of x?.events || []) {
    if (e.playerId && e.player) ids.set(e.playerId, [e.player, e.team?.name]);
    if (e.substitutedPlayerId && e.substituted) ids.set(e.substitutedPlayerId, [e.substituted, e.team?.name]);
    if (!ids.size) console.log('EVENTO CRUDO:', JSON.stringify(e));
  }
}
console.log(`Jugadores distintos en los últimos 15 partidos: ${ids.size}`);
// primero los "A. Soto" y "Hernandez", después el resto
const list = [...ids.entries()].sort((a, b) => (/Soto|Hernandez|Gonzalez/.test(b[1][0]) - /Soto|Hernandez|Gonzalez/.test(a[1][0])));
let full = 0, n = 0, shown = 0;
for (const [id, [abbr, team]] of list.slice(0, 60)) {
  const r = await api(`/players/${id}`); const p = Array.isArray(r) ? r[0] : (r?.data?.[0] || r);
  if (shown < 2 && p) { console.log('JUGADOR CRUDO:', JSON.stringify(p).slice(0, 1500)); shown++; }
  n++;
  const name = p?.fullName || p?.name;
  const isFull = name && !/^[A-Z]\.\s/.test(name);
  if (isFull) full++;
  console.log(`${String(id).padEnd(10)} ${abbr.padEnd(24)} ${String(team).padEnd(22)} -> ${name ?? '—'}${p?.fullName && p?.name ? ' | name: ' + p.name : ''}`);
}
console.log(`\nCon nombre completo: ${full} de ${n}`);
