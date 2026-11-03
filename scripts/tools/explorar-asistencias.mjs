// Solo consulta: ¿la API trae asistencias en los goles de la Liga tica? No guarda nada ni toca la página.
import fs from 'node:fs';
const KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = 'https://soccer.highlightly.net';
const api = async p => { const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': KEY } }); return r.ok ? r.json() : (console.log(`[${r.status}] ${p}`), null); };
const D = JSON.parse(fs.readFileSync('public/data/season.json', 'utf8'));
const T = D.teams;
const played = D.matches.filter(m => m.hs !== undefined && (m.hs + m.as) > 0);
console.log(`Partidos jugados con goles: ${played.length}`);
let goals = 0, withAssist = 0, shown = 0; const keys = new Set(); const asis = {};
for (const m of played) {
  const raw = await api(`/matches/${m.id}`); const x = Array.isArray(raw) ? raw[0] : raw;
  for (const e of x?.events || []) {
    if (!/goal|penalty/i.test(e.type) || /missed|cancel/i.test(e.type)) continue;
    Object.keys(e).forEach(k => keys.add(k));
    if (shown < 3) { console.log('EJEMPLO DE GOL CRUDO:', JSON.stringify(e)); shown++; }
    goals++;
    const a = e.assist || e.assistingPlayer || e.assistPlayer;
    if (a) { withAssist++; const k = (typeof a === 'string' ? a : a.name) + ' | ' + (e.team?.name || ''); asis[k] = (asis[k] || 0) + 1; }
    console.log(`J${m.r} ${T[m.h].name}-${T[m.a].name} ${e.time}' ${e.type} ${e.player} | asistencia: ${a ? JSON.stringify(a) : '—'}`);
  }
}
console.log('\nCampos que trae cada evento de gol:', [...keys].join(', '));
console.log(`\nGoles: ${goals} · con asistencia: ${withAssist} (${goals ? Math.round(100 * withAssist / goals) : 0}%)`);
console.log('\nASISTIDORES:'); Object.entries(asis).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}  ${k}`));
