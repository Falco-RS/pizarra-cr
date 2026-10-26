// Escribe dentro de public/index.html una versión en texto de la tabla, la última jornada y los goleadores,
// para que Google y las vistas previas lean los datos sin ejecutar JavaScript.
// Al cargar la página, app.js reemplaza este bloque por la versión interactiva.
// También genera public/sitemap.xml y public/robots.txt con la dirección del sitio.
// Uso: node scripts/prerender.mjs   (lo llama update.mjs al final)

import fs from 'node:fs/promises';

const SITE_URL = (process.env.SITE_URL || 'https://pizarracr.com').replace(/\/$/, '');
const START = '<!--PRERENDER-->', END = '<!--/PRERENDER-->';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function prerender() {
  const D = JSON.parse(await fs.readFile('public/data/season.json', 'utf8'));
  const T = D.teams;
  const name = id => T[id]?.name || '?';
  const played = D.matches.filter(m => m.hs !== undefined).sort((a, b) => new Date(a.d) - new Date(b.d));
  const lastRound = played.length ? Math.max(...played.map(m => m.r)) : null;

  const table = D.standings.slice().sort((a, b) => a.pos - b.pos).map(s => {
    const t = s.total, dg = t.scoredGoals - t.receivedGoals;
    return `<tr><td>${s.pos}</td><td>${esc(name(s.t))}</td><td>${t.games}</td><td>${t.wins}</td><td>${t.draws}</td><td>${t.loses}</td><td>${dg > 0 ? '+' + dg : dg}</td><td>${s.pts}</td></tr>`;
  }).join('');

  const goals = {};
  for (const m of played) for (const [, type, isHome, player] of (m.ev || [])) {
    if (!player || (type !== 'goal' && type !== 'pen')) continue;
    const tid = isHome ? m.h : m.a, k = player + '|' + tid;
    (goals[k] ||= { player, tid, g: 0 }).g++;
  }
  const scorers = Object.values(goals).sort((a, b) => b.g - a.g).slice(0, 10)
    .map(s => `<li>${esc(s.player)} (${esc(name(s.tid))}): ${s.g} goles</li>`).join('');

  const results = played.filter(m => m.r === lastRound)
    .map(m => `<li>${esc(name(m.h))} ${m.hs} – ${m.as} ${esc(name(m.a))}</li>`).join('');

  const season = D.league?.season || '';
  const block = `${START}
<section class="panel" aria-label="Resumen del torneo">
<h2>Tabla de posiciones · Primera División de Costa Rica ${esc(season)}</h2>
<div class="tw"><table><thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead><tbody>${table}</tbody></table></div>
${lastRound ? `<h2>Resultados de la jornada ${lastRound}</h2><ul>${results}</ul>` : ''}
<h2>Goleadores</h2><ol>${scorers}</ol>
</section>
${END}`;

  let html = await fs.readFile('public/index.html', 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error('No encontré las marcas PRERENDER en public/index.html');
  html = html.slice(0, a) + block + html.slice(b + END.length);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${SITE_URL}/$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${SITE_URL}/$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${SITE_URL}/og.png$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${SITE_URL}/og.png$2`);
  await fs.writeFile('public/index.html', html);

  const lastmod = (D.updated || new Date().toISOString()).slice(0, 10);
  await fs.writeFile('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>
</urlset>
`);
  await fs.writeFile('public/robots.txt', `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prerender().then(() => console.log('Página preparada para Google.')).catch(e => { console.error(e.message); process.exit(1); });
}
