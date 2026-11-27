// Busca el partido de hoy de la Sele Femenina en la API y lo agrega a public/data/sele.json (marcado fem: true)
// para que /api/live lo siga en vivo. Uso: HIGHLIGHTLY_KEY=... FECHA=2026-11-27 node scripts/tools/femenina.mjs
import fs from 'node:fs/promises';
const KEY = process.env.HIGHLIGHTLY_KEY;
const FECHA = process.env.FECHA || new Date().toISOString().slice(0, 10);
const BASE = 'https://soccer.highlightly.net';
const api = async p => { const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': KEY } }); console.log(r.status, p); return r.ok ? r.json() : null; };
const fixText = s => (typeof s === 'string' && /[ÃÂ]/.test(s)) ? Buffer.from(s, 'latin1').toString('utf8') : s;
const OUT = 'public/data/sele.json';
const sj = JSON.parse(await fs.readFile(OUT, 'utf8'));
let found = null, femId = null;
for (const q of ['Costa Rica W', 'Costa Rica Women', 'Jamaica W', 'Jamaica Women']) {
  const ts = (await api(`/teams?name=${encodeURIComponent(q)}&limit=50`))?.data || [];
  console.log(q, '=>', ts.map(t => `${t.name}|${t.type || ''}|${t.id}`).join(' ; '));
}
// recorrer los partidos del día buscando Jamaica vs Costa Rica
for (let off = 0; off < 1500 && !found; off += 100) {
  const page = await api(`/matches?date=${FECHA}&limit=100&offset=${off}`);
  const arr = page?.data || [];
  for (const x of arr) {
    const n = `${x.homeTeam?.name} ${x.awayTeam?.name}`;
    if (/costa rica/i.test(n) && /jamaica/i.test(n)) { found = x; femId = /costa rica/i.test(x.homeTeam.name) ? x.homeTeam.id : x.awayTeam.id; console.log('ENCONTRADO', n, x.league?.name); break; }
  }
  if (arr.length < 100) break;
}
if (!found) { console.error('No encontré el partido'); process.exit(1); }
const slim = t => ({ id: t.id, name: fixText(t.name).replace(/\s+W(omen)?$/i, ''), logo: t.logo || null });
const rec = { id: found.id, d: found.date, comp: found.league?.name, lg: found.league?.id, round: found.round, s: found.state?.description, h: slim(found.homeTeam), a: slim(found.awayTeam), fem: true };
console.log('Partido:', JSON.stringify(rec));
sj.femId = femId;
sj.matches = (sj.matches || []).filter(m => m.id !== rec.id).concat(rec).sort((a, b) => new Date(a.d) - new Date(b.d));
await fs.writeFile(OUT, JSON.stringify(sj));
