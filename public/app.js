function start(D) {
const T = D.teams;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const crest = (id, cls='crest') => { const t = T[id] || { ab:'?' }; return t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="${cls} ph" aria-hidden="true">${esc(t.ab)}</span>`; };
const tz = { timeZone: 'America/Costa_Rica' };
const fmtDay = d => new Date(d).toLocaleDateString('es-CR', { ...tz, weekday:'short', day:'numeric', month:'short' });
const fmtTime = d => new Date(d).toLocaleTimeString('es-CR', { ...tz, hour:'numeric', minute:'2-digit' });
const played = m => m.hs !== undefined;
/* Resultados que cambió el tribunal: el marcador de cancha se muestra, la tabla usa el oficial */
const MESA = D.mesa || {};
const off = m => MESA[m.id] ? { ...m, ...MESA[m.id] } : m;
/* Estadio del equipo local, con enlace al mapa */
const venueOf = m => (ESTADIOS.partidos || {})[m.id] || ESTADIOS[T[m.h]?.name] || '';
const venueHtml = v => v ? ` · <a class="venue" href="https://www.google.com/maps/search/${encodeURIComponent(v + ', Costa Rica')}" target="_blank" rel="noopener">${esc(v)}</a>` : '';
/* Nombres que la API dejó vacíos en el minuto a minuto, completados a mano (public/data/eventos.json) */
// (también se aplica al minuto a minuto en vivo; el minuto puede variar ±2 entre lo que manda la API y lo anotado)
const fillEv = (id, ev) => { ev = ev || []; for (const fx of (EVENTOS[id] || [])) {
  // jugadas que la API no registra (p. ej. penal señalado): se agregan tal cual, una sola vez
  if (fx.agregar) { if (!ev.some(e => e.manual && e[0] === fx.t && e[1] === fx.tipo)) { const x = [fx.t, fx.tipo, fx.local ? 1 : 0, fx.jugador || null, null]; x.manual = true; ev.push(x); } continue; }
  const e = (ev || []).find(e => e[1] === fx.tipo && !e[3] && (String(e[0]) === String(fx.t) || Math.abs(parseInt(e[0]) - parseInt(fx.t)) <= 2));
  if (e) { if (fx.jugador) e[3] = fx.jugador; if (fx.como) e[1] = fx.como; }
} return ev; };
for (const m of D.matches) fillEv(m.id, m.ev);
const M = D.matches.slice().sort((a,b) => new Date(a.d) - new Date(b.d));
const rounds = [...new Set(M.map(m => m.r))].sort((a,b) => a-b);
const lastPlayed = Math.max(...M.filter(played).map(m => m.r));

const soonRound = M.filter(m => !played(m) && new Date(m.d) - Date.now() < 3 * 864e5).map(m => m.r);
const currentRound = soonRound.length && M.filter(m => m.r === lastPlayed).every(played) ? Math.min(...soonRound) : lastPlayed;
let S = { view:'inicio', j:currentRound, sel:null, tmode:'total', moved:false };
try { const v = location.hash.slice(1) === 'goleadores' ? 'estadisticas' : location.hash.slice(1); if (['inicio','tabla','estadisticas','disciplina','ascenso','copa','legionarios','sele'].includes(v)) S.view = v; } catch(e){}

document.getElementById('src').textContent = `Actualizado ${new Date(D.updated).toLocaleString('es-CR',{ ...tz, day:'numeric', month:'short', hour:'numeric', minute:'2-digit' })}`;

/* Tarjetas que la API no registró, corregidas a mano con los datos oficiales de UNAFUT (public/data/tarjetas.json).
   Solo cuentan para disciplina; no se muestran en el minuto a minuto. */
const cardEv = m => {
  const side = x => T[m.h].name === x.equipo ? 1 : T[m.a].name === x.equipo ? 0 : -1;
  const extra = (TARJETAS.extra || []).filter(x => x.r === m.r && side(x) >= 0).map(x => ['', x.tipo || 'yc', side(x), x.jugador]);
  let ev = [...(m.ev || []), ...extra];
  // Doble amarilla en el mismo partido = expulsión: esas amarillas NO suman a la acumulación (cuenta la roja).
  const n = {}; ev.forEach(e => { if (e[1] === 'yc' && e[3]) n[e[2] + '|' + e[3]] = (n[e[2] + '|' + e[3]] || 0) + 1; });
  ev = ev.filter(e => !(e[1] === 'yc' && n[e[2] + '|' + e[3]] >= 2));
  // Amarillas que la API puso de más (no están en el conteo oficial)
  for (const q of (TARJETAS.quitar || []).filter(x => x.r === m.r && side(x) >= 0)) {
    const i = ev.findIndex(e => e[1] === (q.tipo || 'yc') && e[3] === q.jugador && e[2] === side(q));
    if (i >= 0) ev.splice(i, 1);
  }
  return ev;
};
/* ---------- aggregates from events ---------- */
const scorers = {}, yellows = {}, reds = [], teamCards = {};
for (const m of M.filter(played)) {
  for (const [time, type, isHome, player, subIn] of cardEv(m)) {
    const tid = isHome ? m.h : m.a, opp = isHome ? m.a : m.h;
    if (!player) continue;
    const key = player + '|' + tid;
    if (type === 'goal' || type === 'pen') {
      const s = scorers[key] ||= { name: player, t: tid, g: 0, pen: 0, matches: new Set() };
      s.g++; if (type === 'pen') s.pen++; s.matches.add(m.id);
    }
    if (type === 'yc') { const y = yellows[key] ||= { name: player, t: tid, n: 0, last: 0 }; y.n++; y.last = Math.max(y.last, m.r); }
    if (type === 'rc') reds.push({ name: player, t: tid, r: m.r, opp, time });
    if (type === 'yc' || type === 'rc') { const tc = teamCards[tid] ||= { y:0, r:0 }; tc[type === 'yc' ? 'y' : 'r']++; }
  }
}
const topScorers = Object.values(scorers).sort((a,b) => b.g - a.g || a.pen - b.pen || a.name.localeCompare(b.name));
const topYellow = Object.values(yellows).sort((a,b) => b.n - a.n || b.last - a.last);

/* Regla de UNAFUT: 5 amarillas en el torneo = 1 partido de suspensión y el conteo vuelve a cero.
   Roja = al menos 1 partido (el tribunal puede dar más). */
const YELLOW_LIMIT = 5;
const lastMatchOf = {}; M.filter(played).forEach(m => { lastMatchOf[m.h] = m; lastMatchOf[m.a] = m; });
const nextMatchOf = t => M.find(m => !played(m) && (m.h === t || m.a === t));
const cycle = {}, suspensions = [];
for (const m of M.filter(played)) {
  for (const [time, type, isHome, player] of cardEv(m)) {
    if (!player || (type !== 'yc' && type !== 'rc')) continue;
    const tid = isHome ? m.h : m.a, key = player + '|' + tid;
    if (type === 'yc') {
      cycle[key] = (cycle[key] || 0) + 1;
      if (cycle[key] === YELLOW_LIMIT) { suspensions.push({ name: player, t: tid, after: m, why: '5 amarillas' }); cycle[key] = 0; }
    } else {
      const san = [...(TARJETAS.sanciones || []), ...(TARJETAS.extra || [])].find(x => x.partidos && x.jugador === player && x.r === m.r && x.equipo === T[tid].name);
      suspensions.push({ name: player, t: tid, after: m, why: 'Roja', n: san ? san.partidos : 1 });
    }
  }
}
for (const y of Object.values(yellows)) y.cycle = cycle[y.name + '|' + y.t] || 0;
/* suspendidos para el próximo partido de su equipo: la sanción salió de su último partido jugado */
/* (sanciones de varios partidos: sigue suspendido mientras su equipo no haya jugado esa cantidad de partidos después) */
const playedAfter = s => M.filter(m => played(m) && (m.h === s.t || m.a === s.t) && new Date(m.d) > new Date(s.after.d)).length;
const suspendedNext = suspensions.filter(s => playedAfter(s) < (s.n || 1))
  .map(s => {
    const left = (s.n || 1) - playedAfter(s);
    const nexts = M.filter(m => !played(m) && (m.h === s.t || m.a === s.t)).slice(0, left);
    return { ...s, next: nexts[0], nexts, why: s.n > 1 ? `Roja · ${left === 1 ? 'le queda 1 partido' : left + ' partidos'}` : s.why };
  });
const onFour = Object.values(yellows).filter(y => y.cycle === YELLOW_LIMIT - 1).sort((a,b) => a.name.localeCompare(b.name));
reds.sort((a,b) => b.r - a.r);

/* form + table from matches */
function formOf(tid, mode) {
  return M.filter(m => played(m) && (mode === 'home' ? m.h === tid : mode === 'away' ? m.a === tid : (m.h === tid || m.a === tid)))
    .slice(-5).map(m => { const o = off(m), gf = m.h === tid ? o.hs : o.as, ga = m.h === tid ? o.as : o.hs; return gf > ga ? 'W' : gf < ga ? 'L' : 'D'; });
}
function tableRows(mode) {
  // Se calcula con los resultados (incluye partidos recién terminados y los ganados en la mesa),
  // así no depende de que Highlightly actualice su tabla.
  const acc = {};
  for (const t of Object.keys(T)) acc[t] = { t: +t, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
  const results = M.map(m => {
    if (played(m)) return off(m);
    // también los partidos EN VIVO, con el marcador del momento (la tabla se mueve mientras se juega)
    const lv = LIVE.find(x => x.id === m.id && x.started && x.score);
    return lv ? { ...m, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], enVivo: !lv.finished } : null;
  }).filter(Boolean);
  for (const m of results) {
    for (const [tid, gf, ga, isHome] of [[m.h, m.hs, m.as, true], [m.a, m.as, m.hs, false]]) {
      if (mode === 'home' && !isHome) continue;
      if (mode === 'away' && isHome) continue;
      const r = acc[tid] ||= { t: tid, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
      r.pj++; r.gf += gf; r.gc += ga;
      if (m.enVivo) r.live = { gf, ga, k: gf > ga ? 'W' : gf < ga ? 'L' : 'D' };
      if (gf > ga) { r.g++; r.pts += 3; } else if (gf === ga) { r.e++; r.pts += 1; } else r.p++;
    }
  }
  const rows = Object.values(acc);
  rows.sort((a,b) => b.pts - a.pts || (b.gf-b.gc) - (a.gf-a.gc) || b.gf - a.gf);
  return rows;
}
const formHtml = f => `<span class="form" aria-label="Últimos 5: ${f.map(x => ({W:'ganó',D:'empató',L:'perdió'})[x]).join(', ')}">${f.map(x => `<i class="${x}">${({W:'G',D:'E',L:'P'})[x]}</i>`).join('')}</span>`;

/* ---------- jornada board ---------- */
const jsel = document.getElementById('jsel');
jsel.innerHTML = rounds.map(r => `<option value="${r}">Jornada ${r}</option>`).join('');
jsel.onchange = () => { S.moved = true; S.j = +jsel.value; S.sel = null; renderBoard(); };
document.getElementById('prev').onclick = () => { S.moved = true; S.j--; S.sel = null; renderBoard(); };
document.getElementById('next').onclick = () => { S.moved = true; S.j++; S.sel = null; renderBoard(); };

function statusLine(m) {
  if (m.liveClock !== undefined) return `EN VIVO ${m.liveClock ?? ''}'`;
  if (m.s === 'Awarded') return 'Por reglamento';
  if (MESA[m.id]) return 'Final · ganado en la mesa';
  if (played(m)) return 'Final';
  return fmtTime(m.d);
}
function renderBoard() {
  const list = M.filter(m => m.r === S.j);
  document.getElementById('jt').textContent = `Jornada ${S.j}`;
  jsel.value = S.j;
  document.getElementById('prev').disabled = S.j <= rounds[0];
  document.getElementById('next').disabled = S.j >= rounds[rounds.length-1];
  document.getElementById('mgrid').innerHTML = list.map(m0 => {
    // también se usa el resultado del en vivo recién terminado, mientras llega la actualización de datos
    const lv = !played(m0) && LIVE.find(x => x.id === m0.id && x.started && x.score);
    const m = lv ? { ...m0, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: fillEv(m0.id, lv.events), ...(lv.finished ? {} : { liveClock: lv.clock }) } : m0;
    const live = lv && !lv.finished;
    const p = played(m), hl = p && !live && m.hs < m.as, al = p && !live && m.as < m.hs;
    return `<button class="mc" data-id="${m.id}" aria-pressed="${S.sel === m.id}">
      <span class="meta"><span>${esc(fmtDay(m.d))}</span><span>${esc(statusLine(m))}</span></span>
      <span class="row ${hl ? 'lose' : ''}">${crest(m.h)}<span>${esc(T[m.h].name)}</span><span class="sc">${p ? m.hs : ''}</span></span>
      <span class="row ${al ? 'lose' : ''}">${crest(m.a)}<span>${esc(T[m.a].name)}</span><span class="sc">${p ? m.as : ''}</span></span>
    </button>`;
  }).join('');
  document.querySelectorAll('.mc').forEach(b => b.onclick = () => {
    const id = +b.dataset.id, m = M.find(x => x.id === id);
    S.sel = S.sel === id ? null : id; renderBoard();
  });
  renderDetail();
}

/* ---------- previa ---------- */
const PREVIA = {};   // respuestas de /api/previa por partido (alineación oficial y probabilidades)
const POS = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };
// Arma las líneas de la cancha con la formación ("4-3-3") y la lista de once en orden.
function rowsFrom(formation, xi) {
  const nums = String(formation || '').split('-').map(Number).filter(Boolean);
  if (!xi || xi.length !== 11 || nums.reduce((a, b) => a + b, 0) !== 10) {
    const g = [[], [], [], []]; (xi || []).forEach(p => g[POS[p.pos] ?? 2].push(p)); return g.filter(r => r.length);
  }
  const rows = [xi.slice(0, 1)]; let i = 1;
  for (const n of nums) { rows.push(xi.slice(i, i + n)); i += n; }
  return rows;
}
// La última alineación conocida de un equipo (la "probable" mientras no sale la oficial)
function lastLineup(tid) {
  // Última alineación conocida del equipo: la de la API o la publicada por el club (cargada a mano), la más reciente
  const ms = M.filter(x => played(x) && (x.h === tid || x.a === tid)).reverse();
  for (const x of ms) {
    const man = MANUAL[x.id]?.[x.h === tid ? 'home' : 'away'];
    if (man?.rows) return { formation: man.formation, rows: man.rows, from: x };
    const L = D.detail[String(x.id)]?.lineups?.[x.h === tid ? 'h' : 'a'];
    if (L && L.xi && L.xi.length) return { formation: L.f, rows: rowsFrom(L.f, L.xi), from: x };
  }
  return null;
}
const surname = n => { const parts = String(n || '').split(' '); return /^[A-ZÁÉÍÓÚÑ]\.$/.test(parts[0]) ? parts.slice(1).join(' ') : String(n || ''); };
/* Colores de cada equipo en la cancha (si los dos se parecen, la visita usa el azul de siempre) */
const KIT = { 'Saprissa': ['#7B1E57', '#fff'], 'Alajuelense': ['#D7263D', '#fff'], 'Herediano': ['#F2C200', '#141A16'], 'Cartaginés': ['#1F3B8A', '#fff'],
  'San Carlos': ['#1F3B8A', '#fff'], 'Puntarenas': ['#F37021', '#141A16'], 'Pérez Zeledón': ['#3D5FBF', '#fff'], 'Escorpiones Belén': ['#F5D300', '#141A16'],
  'Inter San Carlos': ['#2E8B57', '#fff'], 'Sporting': ['#F4F6F2', '#141A16'] };
function kitVars(hName, aName) {
  const nn = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // el nombre más largo gana: "Inter San Carlos" no debe agarrar los colores de "San Carlos"
  const find = n => Object.entries(KIT).filter(([k]) => nn(n).includes(nn(k))).sort((x, y) => y[0].length - x[0].length)[0]?.[1];
  const h = find(hName) || ['#F4F6F2', '#141A16'];
  let a = find(aName) || ['#2F62D8', '#fff'];
  if (a[0] === h[0]) a = h[0] === '#2F62D8' ? ['#F4F6F2', '#141A16'] : ['#2F62D8', '#fff'];
  return `--kh:${h[0]};--kht:${h[1]};--ka:${a[0]};--kat:${a[1]}`;
}
const pkey = n => { const w = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').split(/\s+/).filter(Boolean); return w.length ? w[0][0] + ' ' + w[w.length - 1] : ''; };
function pitchHtml(home, away, susp = {}) {
  const isS = (side, n) => (susp[side] || []).some(x => pkey(x) === pkey(n));
  const place = (side, rows, top) => rows.map((row, i) => {
    const t = rows.length === 1 ? 0.5 : i / (rows.length - 1), y = top ? 7 + t * 36 : 93 - t * 36;
    return row.map((p, j) => `<div class="pl ${side}${isS(side, p.name) ? ' susp' : ''}" style="left:${(j + 1) / (row.length + 1) * 100}%;top:${y}%;width:${row.length >= 5 ? 18 : 22}%"${isS(side, p.name) ? ' title="Suspendido para este partido"' : ''}><b>${esc(p.n ?? '')}</b><span>${esc(surname(p.name))}</span></div>`).join('');
  }).join('');
  return `<div class="pitch" role="img" aria-label="Alineaciones en la cancha">
    <div class="ln out"></div><div class="ln mid"></div><div class="ln circle"></div><div class="ln box1"></div><div class="ln box2"></div>
    ${home?.rows ? place('h', home.rows, true) : `<p class="pempty top">${home?.list ? 'XI inicial confirmado abajo' : 'Sin alineación disponible'}</p>`}
    ${away?.rows ? place('a', away.rows, false) : `<p class="pempty bot">${away?.list ? 'XI inicial confirmado abajo' : 'Sin alineación disponible'}</p>`}</div>`;
}
/* XI publicado por el club como lista (sin posiciones) */
function xiListHtml(name, L) {
  if (!L?.list) return '';
  return `<div class="xil"><p class="lead"><b>${esc(name)}</b> · XI inicial confirmado${L.fuente ? `` : ''}</p>
    <ol>${L.list.map(p => `<li><b>${esc(p.n ?? '')}</b>${esc(p.name)}${p.c ? ' <span class="chip">C</span>' : ''}</li>`).join('')}</ol>
    ${L.subs?.length ? `<p class="foot">Suplentes: ${L.subs.map(p => `${p.n ?? ''} ${esc(p.name)}`.trim()).join(' · ')}</p>` : ''}</div>`;
}
function renderPrevia(m, box) {
  const P = PREVIA[m.id];
  if (P === undefined) {
    PREVIA[m.id] = null;
    fetch('/api/previa?id=' + m.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { PREVIA[m.id] = j || {}; if (S.sel === m.id) renderDetail(); });
  }
  const OLs = key => (P && P.lineups && P.lineups[key]) || (MANUAL[m.id] || {})[key] || null;
  const off_ = !!(OLs('home') || OLs('away'));
  const side = (tid, key) => OLs(key) ? OLs(key) : lastLineup(tid);
  const H = side(m.h, 'home'), A = side(m.a, 'away');
  const suspOf = t => nextMatchOf(t)?.id === m.id ? suspendedNext.filter(x => x.t === t).map(x => x.name) : [];
  const SUSP = { h: suspOf(m.h), a: suspOf(m.a) };
  const lineNote = off_ && !(OLs('home') && OLs('away')) ? `<span class="chip ok">Oficial</span> ${esc(T[OLs('home') ? m.h : m.a].name)} (publicada por el club) · <span class="chip">Probable</span> ${esc(T[OLs('home') ? m.a : m.h].name)}, la última que usó`
    : off_ ? `<span class="chip ok">Alineación oficial</span>${!(P && P.lineups) ? ' publicada por los clubes' : ''}`
    : `<span class="chip">Probable</span> última alineación de cada equipo`;

  const rows = tableRows('total'), pos = t => rows.findIndex(r => r.t === t) + 1, row = t => rows.find(r => r.t === t);
  const hr = row(m.h), ar = row(m.a);
  const rec = (t, mode) => { const r = tableRows(mode).find(x => x.t === t); return r ? `${r.g}-${r.e}-${r.p}` : '—'; };
  const avg = (a, b) => b ? (a / b).toFixed(1) : '—';
  const cmp = [
    ['Posición', `${pos(m.h)}.º`, `${pos(m.a)}.º`], ['Puntos', hr.pts, ar.pts],
    ['Récord (G-E-P)', `${hr.g}-${hr.e}-${hr.p}`, `${ar.g}-${ar.e}-${ar.p}`],
    ['Goles por partido', avg(hr.gf, hr.pj), avg(ar.gf, ar.pj)], ['Recibe por partido', avg(hr.gc, hr.pj), avg(ar.gc, ar.pj)],
    [`${esc(T[m.h].name)} de local / ${esc(T[m.a].name)} de visita`, rec(m.h, 'home'), rec(m.a, 'away')],
  ];
  const isNext = t => nextMatchOf(t)?.id === m.id;
  const bajas = t => `<div><h3>${esc(T[t].name)}</h3><ul class="plist">
    ${isNext(t) ? suspendedNext.filter(x => x.t === t).map(x => `<li><span class="chip sus">No juega</span>${esc(x.name)}<span class="x">${esc(x.why)}</span></li>`).join('') : '<li><span class="x" style="margin:0">Las bajas se confirman al terminar su partido anterior</span></li>'}
    ${onFour.filter(y => y.t === t).map(y => `<li><span class="chip cap4">4 amarillas</span>${esc(y.name)}<span class="x">en capilla</span></li>`).join('')}
    ${isNext(t) && !suspendedNext.some(x => x.t === t) && !onFour.some(y => y.t === t) ? '<li><span class="x" style="margin:0">Sin suspendidos ni jugadores en capilla</span></li>' : ''}</ul></div>`;
  const last5 = t => `<div><h3>${esc(T[t].name)}</h3><ul class="plist">${M.filter(x => played(x) && (x.h === t || x.a === t)).slice(-5).reverse().map(x0 => {
    const x = off(x0), home = x.h === t, gf = home ? x.hs : x.as, ga = home ? x.as : x.hs, r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return `<li><span class="res ${r}">${({W:'G',D:'E',L:'P'})[r]}</span>${home ? 'vs' : 'en'} ${esc(T[home ? x.a : x.h].name)}<span class="x">${gf}–${ga} · J${x.r}</span></li>`; }).join('')}</ul></div>`;
  const h2h = M.filter(x => played(x) && ((x.h === m.h && x.a === m.a) || (x.h === m.a && x.a === m.h))).map(off);
  const gol = t => `<div><h3>${esc(T[t].name)}</h3><ul class="plist">${topScorers.filter(g => g.t === t).slice(0, 3).map(g => `<li>${esc(g.name)}${isNext(t) && suspendedNext.some(x => x.t === t && x.name === g.name) ? ' <span class="chip sus">No juega</span>' : ''}<span class="x">${g.g} ${g.g === 1 ? 'gol' : 'goles'}</span></li>`).join('') || '<li><span class="x" style="margin:0">Sin goles todavía</span></li>'}</ul></div>`;
  const pr = P && P.predictions?.prematch?.length ? P.predictions.prematch[P.predictions.prematch.length - 1].probabilities : null;
  const prob = pr ? (() => { const h = parseFloat(pr.home), d = parseFloat(pr.draw), a = parseFloat(pr.away);
    return `<div class="pred"><div class="bar"><i style="flex:${h};background:var(--accent)"></i><i style="flex:${d};background:var(--draw)"></i><i style="flex:${a};background:var(--away)"></i></div>
      <div class="lab"><span>${esc(T[m.h].name)} <b>${Math.round(h)}%</b></span><span>Empate <b>${Math.round(d)}%</b></span><span>${esc(T[m.a].name)} <b>${Math.round(a)}%</b></span></div></div>`; })() : '';

  box.innerHTML = `<div class="detail">
    <div class="dscore">
      <div class="dteam r"><span>${esc(T[m.h].name)}</span>${crest(m.h)}</div>
      <div><div class="dnum" style="font-size:40px">${esc(fmtTime(m.d))}</div></div>
      <div class="dteam">${crest(m.a)}<span>${esc(T[m.a].name)}</span></div>
    </div>
    <div class="dmeta">Previa · ${esc(fmtDay(m.d))} · Jornada ${m.r}${venueHtml(venueOf(m) || (P && P.venue?.name) || '')}</div>
    ${prob}
    <div class="pv">
      <section class="pv-lu" style="${kitVars(T[m.h].name, T[m.a].name)}"><h3>Alineaciones</h3><p class="lead">${lineNote}</p>
        <div class="fbar"><span><i class="dot h"></i> ${esc(T[m.h].name)}</span><span class="f">${esc(H?.formation || '')}</span></div>
        ${pitchHtml(H, A, SUSP)}
        <div class="fbar"><span><i class="dot a"></i> ${esc(T[m.a].name)}</span><span class="f">${esc(A?.formation || '')}</span></div>
        ${(!OLs('home') && SUSP.h.length && H) || (!OLs('away') && SUSP.a.length && A) ? '<p class="foot"><span style="color:var(--loss);font-weight:700">En rojo:</span> suspendido para este partido (no puede jugar).</p>' : ''}
        ${H?.dt || A?.dt ? `<div class="dts">${H?.dt ? `<span><i class="dot h"></i> DT ${esc(H.dt)}</span>` : ''}${A?.dt ? `<span><i class="dot a"></i> DT ${esc(A.dt)}</span>` : ''}</div>` : ''}
        ${xiListHtml(T[m.h].name, H)}${xiListHtml(T[m.a].name, A)}
        
      </section>
      <div class="pv-data">
        <section><h3>Bajas y alertas</h3><div class="two">${bajas(m.h)}${bajas(m.a)}</div></section>
        <section><h3>Cómo llegan</h3><table class="cmp"><tr><td>${esc(T[m.h].ab)}</td><td></td><td>${esc(T[m.a].ab)}</td></tr>${cmp.map(c => `<tr><td>${c[1]}</td><td>${c[0]}</td><td>${c[2]}</td></tr>`).join('')}</table></section>
        <section><h3>Últimos 5</h3><div class="two">${last5(m.h)}${last5(m.a)}</div></section>
        <section><h3>Cara a cara en el torneo</h3><ul class="plist">${h2h.length ? h2h.map(x => `<li>J${x.r} · ${esc(T[x.h].name)} <b>${x.hs}–${x.as}</b> ${esc(T[x.a].name)}</li>`).join('') : '<li><span class="x" style="margin:0">No se han enfrentado en este torneo</span></li>'}</ul></section>
        <section><h3>Goleadores</h3><div class="two">${gol(m.h)}${gol(m.a)}</div></section>
      </div>
    </div></div>`;
}

const EVL = { dra:'Doble amarilla · expulsado', psen:'Penal señalado', goal:'Gol', pen:'Gol de penal', og:'Autogol', yc:'Amarilla', rc:'Roja', sub:'Cambio', mp:'Penal fallado', var:'Gol anulado' };
const ICO = { dra:'rc', goal:'goal', pen:'goal', og:'goal', yc:'yc', rc:'rc', mp:'miss', var:'miss' };
function evHtml(e) {
  const [time, type, , player, subIn] = e;
  const ic = type === 'sub' ? '<span class="ico sub" aria-hidden="true">⇄</span>' : `<span class="ico ${ICO[type] || 'miss'}" aria-hidden="true"></span>`;
  let txt;
  if (type === 'sub') txt = `<span>Entra <b>${esc(subIn)}</b> <span class="note">sale ${esc(player)}</span></span>`;
  else txt = `<span><b>${esc(player || '')}</b> <span class="note">${EVL[type] || esc(type)}</span></span>`;
  return `<span class="ev">${ic}${txt}</span>`;
}
const STATS = [['Possession','Posesión',v => Math.round(v*100)+'%', v => v],['Shots on target','Remates al arco'],['Shots off target','Remates desviados'],['Blocked shots','Remates bloqueados'],['Corners','Tiros de esquina'],['Offsides','Fueras de juego'],['Free Kicks','Tiros libres'],['Yellow cards','Amarillas'],['Red cards','Rojas'],['Attacks','Ataques']];
function renderDetail() {
  const box = document.getElementById('detail');
  const base = M.find(x => x.id === S.sel);
  const lv = base && LIVE.find(x => x.id === base.id && x.started);
  const m = lv ? { ...base, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: reconcile(fillEv(base.id, lv.events), +lv.score.split(' - ')[0], +lv.score.split(' - ')[1], !lv.finished), liveClock: lv.finished ? undefined : lv.clock } : base;
  if (!m) { box.innerHTML = ''; return; }
  if (!played(m) && !lv) { renderPrevia(m, box); return; }
  const ev = (m.ev || []).slice().sort((a,b) => parseInt(a[0]) - parseInt(b[0]) || (a[0].includes('+') - b[0].includes('+')));
  const det = lv && lv.stats && lv.stats.length === 2 ? { stats: lv.stats.map(t => t.s), statsTeams: lv.stats.map(t => t.t), lineups: null } : D.detail[String(m.id)];
  let extra = '';
  const bars = det && det.stats && det.stats.length === 2 ? (() => { const hi = det.statsTeams[0] === m.h ? 0 : 1, ai = 1 - hi;
    return STATS.map(([k, lab, f = v => v]) => {
      const h = det.stats[hi][k], a = det.stats[ai][k]; if (h === undefined || h === null) return '';
      const tot = (h + a) || 1;
      return `<div class="sbar"><div class="lab"><span>${f(h)}</span><span>${lab}</span><span>${f(a)}</span></div>
        <div class="bars"><i style="flex:${h/tot || .001};background:var(--accent)"></i><i style="flex:${a/tot || .001};background:var(--draw)"></i></div></div>`;
    }).join(''); })() : '';
  // equipos para los que la fuente nunca trae estadísticas (ej. San Carlos): ahí no se muestra el cuadro vacío
  const conStats = t => M.some(x => (x.h === t || x.a === t) && (() => { const st = (XSTATS.matches || {})[x.id]; return st && st.h && Object.keys(st.h).length; })());
  const statsBlock = bars ? `<div><h3>Estadísticas</h3>${bars}</div>` : lv && !lv.finished && conStats(m.h) && conStats(m.a) ? `<div><h3>Estadísticas</h3><p class="hint">Todavía sin estadísticas.</p></div>` : '';
  // Alineaciones: las de la API si las trae; si no, las publicadas por los clubes (cargadas a mano)
  const xi = side => `<ol>${side.xi.map(p => `<li><b>${p.n ?? ''}</b><span>${esc(p.name)}</span></li>`).join('')}</ol>`;
  const man = MANUAL[m.id];
  const lineBlock = det?.lineups?.h?.xi?.length
    ? `<div><h3>Alineaciones</h3><div class="lu"><div><p class="lead">${esc(T[m.h].name)} · ${esc(det.lineups.h.f)}</p>${xi(det.lineups.h)}</div><div><p class="lead">${esc(T[m.a].name)} · ${esc(det.lineups.a.f)}</p>${xi(det.lineups.a)}</div></div></div>`
    : man ? `<div class="pv-lu" style="${kitVars(T[m.h].name, T[m.a].name)}"><h3>Alineaciones</h3>
        <div class="fbar"><span><i class="dot h"></i> ${esc(T[m.h].name)}</span><span class="f">${esc(man.home?.formation || '')}</span></div>
        ${pitchHtml(man.home, man.away)}
        <div class="fbar"><span><i class="dot a"></i> ${esc(T[m.a].name)}</span><span class="f">${esc(man.away?.formation || '')}</span></div>
        ${man.home?.dt || man.away?.dt ? `<div class="dts">${man.home?.dt ? `<span><i class="dot h"></i> DT ${esc(man.home.dt)}</span>` : ''}${man.away?.dt ? `<span><i class="dot a"></i> DT ${esc(man.away.dt)}</span>` : ''}</div>` : ''}</div>`
    : '';
  // sin estadísticas: en ese espacio van los suplentes (de las alineaciones publicadas por los clubes)
  const subsList = x => x?.subs?.length ? `<ul class="plist">${x.subs.map(p => `<li><b style="min-width:26px;display:inline-block">${p.n ?? ''}</b>${esc(p.name)}</li>`).join('')}</ul>` : '<p class="hint">Sin datos.</p>';
  const subsBlock = !statsBlock && man && (man.home?.subs?.length || man.away?.subs?.length)
    ? `<div><h3>Suplentes</h3><div class="two"><div><p class="lead">${esc(T[m.h].name)}</p>${subsList(man.home)}</div><div><p class="lead">${esc(T[m.a].name)}</p>${subsList(man.away)}</div></div></div>` : '';
  if (statsBlock || lineBlock) extra = `<div class="dcols">${lineBlock}${statsBlock || subsBlock}</div>`;
  else if (!det && !lv) extra = '';
  box.innerHTML = `<div class="detail">
    <div class="dscore">
      <div class="dteam r"><span>${esc(T[m.h].name)}</span>${crest(m.h)}</div>
      <div><div class="dnum">${m.hs} – ${m.as}</div></div>
      <div class="dteam">${crest(m.a)}<span>${esc(T[m.a].name)}</span></div>
    </div>
    <div class="dmeta">${esc(statusLine(m))} · ${esc(fmtDay(m.d))}, ${esc(fmtTime(m.d))} · Jornada ${m.r}${venueHtml(venueOf(m))}</div>
    ${MESA[m.id] ? `<p class="hint" style="margin:12px auto 0;max-width:620px;text-align:center">${esc(MESA[m.id].note)}</p>` : ''}
    <div class="dcols"><div><h3>Minuto a minuto</h3>
      ${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Sin eventos registrados.</p>'}
    </div></div>${extra}</div>`;
}

/* ---------- views ---------- */
function tableHtml(mode, compact) {
  const rows = tableRows(mode);
  return `<div class="tw"><table>
    <thead><tr><th class="l">#</th><th class="l">Equipo</th><th>PJ</th>${compact ? '' : '<th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th>'}<th>DG</th><th>Pts</th>${compact ? '' : '<th class="l">Últimos 5</th>'}</tr></thead>
    <tbody>${rows.map((r,i) => { const dg = r.gf - r.gc; return `<tr>
      <td class="l"><span class="pos">${i+1}</span></td>
      <td class="l"><span class="tn">${crest(r.t)}${esc(T[r.t].name)}${r.live ? `<span class="lvc ${r.live.k}" title="En vivo">${r.live.gf}-${r.live.ga}</span>` : ''}</span></td>
      <td>${r.pj}</td>${compact ? '' : `<td>${r.g}</td><td>${r.e}</td><td>${r.p}</td><td>${r.gf}</td><td>${r.gc}</td>`}
      <td>${dg > 0 ? '+' + dg : dg}</td><td class="pts">${r.pts}</td>${compact ? '' : `<td class="l">${formHtml(formOf(r.t, mode))}</td>`}</tr>`; }).join('')}</tbody></table></div>`;
}
function scorersHtml(n) {
  return `<ol class="list">${topScorers.slice(0, n).map((s,i) => `<li><span class="pos">${i+1}</span>${crest(s.t)}
    <span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)} · gol en ${s.matches.size} partido${s.matches.size === 1 ? '' : 's'}${s.pen ? ` · ${s.pen} de penal` : ''}</span></span><span class="big">${s.g}</span></li>`).join('')}</ol>`;
}
/* ---------- pestaña Estadísticas ---------- */
const pname = (name, tid) => (XSTATS.names || {})[tid + '|' + name] || name;
const minN = t => { const [a, b] = String(t || '0').split('+'); return +a + (b ? +b / 100 : 0); };
const sRows = (rows, fmt = v => v) => `<ol class="list srank">${rows.map((r, i) => `<li><span class="pos">${r.pos ?? i + 1}</span>${crest(r.t)}<span class="nm"><b>${esc(r.name)}</b>${r.sub !== undefined ? `<span>${esc(r.sub)}</span>` : (r.name === T[r.t]?.name ? '' : `<span>${esc(T[r.t]?.name ?? '')}</span>`)}</span>${r.bar !== undefined ? `<span class="rbar"><i style="width:${Math.max(3, Math.min(100, r.bar))}%"></i></span>` : ''}<span class="sval">${fmt(r.v)}</span></li>`).join('')}</ol>`;
const ranked = (arr, key) => { let last, pos = 0; return arr.map((x, i) => { if (x[key] !== last) { pos = i + 1; last = x[key]; } return { ...x, pos }; }); };
const sCard = (title, body, note, wide) => `<section class="scard${wide ? ' wide' : ''}"><h3>${title}</h3>${body}${note ? `<p class="foot">${note}</p>` : ''}</section>`;
function statsHtml() {
  const P = M.filter(played);
  const tids = Object.keys(T).map(Number).filter(t => P.some(m => m.h === t || m.a === t));
  /* jugadores, del minuto a minuto */
  const bench = {}, lateG = {}, half = {}, braces = {};
  for (const m of P) {
    const ev = m.ev || [], cameIn = {}, gm = {};
    for (const e of ev) if (e[1] === 'sub' && e[4]) cameIn[e[2] + '|' + e[4]] = minN(e[0]);
    for (const e of ev) {
      if (!['goal', 'pen', 'og'].includes(e[1])) continue;
      const scorerTeam = e[2] ? m.h : m.a;   // en la API el autogol viene del lado del equipo beneficiado
      const mn = minN(e[0]);
      const h = half[scorerTeam] ||= { a: 0, b: 0 }; (String(e[0]).startsWith('45+') || mn <= 45) ? h.a++ : h.b++;
      if (mn >= 76) lateG[scorerTeam] = (lateG[scorerTeam] || 0) + 1;
      if (e[1] === 'og' || !e[3]) continue;
      const k = e[3] + '|' + scorerTeam;
      if (cameIn[e[2] + '|' + e[3]] !== undefined && cameIn[e[2] + '|' + e[3]] <= mn) bench[k] = (bench[k] || 0) + 1;
      gm[k] = (gm[k] || 0) + 1;
    }
    for (const [k, n] of Object.entries(gm)) if (n >= 2) (braces[k] ||= []).push(n);
  }
  const fromKey = (obj, f) => Object.entries(obj).map(([k, v]) => { const [n, t] = k.split('|'); return { name: pname(n, +t), t: +t, ...f(v) }; });
  const goles = ranked(topScorers.map(s => ({ name: pname(s.name, s.t), t: s.t, v: s.g, sub: T[s.t].name })), 'v');
  const nG = S.allg ? goles.length : 5;
  const penal = ranked(topScorers.filter(s => s.pen).map(s => ({ name: pname(s.name, s.t), t: s.t, v: s.pen })).sort((a, b) => b.v - a.v), 'v').slice(0, 5);
  const banco = ranked(fromKey(bench, v => ({ v })).sort((a, b) => b.v - a.v), 'v').slice(0, 5);
  const dobletes = ranked(fromKey(braces, v => ({ v: v.length, sub: undefined, x: v })).map(r => ({ ...r, sub: `${T[r.t].name} · ${r.x.map(n => n === 2 ? 'doblete' : n === 3 ? 'triplete' : n + ' goles').join(', ')}` })).sort((a, b) => b.v - a.v), 'v').slice(0, 5);
  /* jugadores, de la fuente de datos (asistencias y minutos) */
  const PL = (XSTATS.players || []).filter(p => p.pj !== undefined && T[p.t]);
  const gOf = p => (scorers[p.abbr + '|' + p.t] || {}).g || 0;
  const asis = ranked(PL.filter(p => p.a > 0).map(p => ({ name: p.name || p.abbr, t: p.t, v: p.a, sub: `${T[p.t].name} · ${p.pj} PJ` })).sort((a, b) => b.v - a.v), 'v').slice(0, 5);
  const ga = ranked(PL.map(p => ({ name: p.name || p.abbr, t: p.t, g: gOf(p), a: p.a || 0 })).map(r => ({ ...r, v: r.g + r.a, sub: `${T[r.t].name} · ${r.g} G + ${r.a} A` })).filter(r => r.v > 0).sort((a, b) => b.v - a.v || b.g - a.g), 'v').slice(0, 5);
  const mins = ranked(PL.filter(p => p.min).map(p => ({ name: p.name || p.abbr, t: p.t, v: p.min, sub: `${T[p.t].name} · ${p.pj} PJ` })).sort((a, b) => b.v - a.v), 'v').slice(0, 5);
  /* equipos, de las estadísticas de cada partido */
  const acc = {};
  for (const m of P) { const st = (XSTATS.matches || {})[m.id]; if (!st) continue;
    if (!st.h || !st.a || !Object.keys(st.h).length || !Object.keys(st.a).length) continue;
    for (const [t, x, o] of [[m.h, st.h, st.a], [m.a, st.a, st.h]]) { const a = acc[t] ||= { n: 0, pos: 0, son: 0, sh: 0, cor: 0, off: 0, sonC: 0 }; a.n++; a.pos += x.pos || 0; a.son += x.son || 0; a.sh += (x.son || 0) + (x.soff || 0) + (x.sblk || 0); a.cor += x.cor || 0; a.off += x.off || 0; a.sonC += o.son || 0; } }
  const tAvg = (f, dec = 1, asc) => { const rows = Object.entries(acc).filter(([, a]) => a.n).map(([t, a]) => ({ t: +t, name: T[t].name, v: f(a) })).sort((a, b) => asc ? a.v - b.v : b.v - a.v); const max = Math.max(...rows.map(r => r.v)) || 1; return ranked(rows.map(r => ({ ...r, v: +r.v.toFixed(dec), bar: 100 * r.v / max })), 'v'); };
  const nst = Object.values(acc).reduce((s, a) => s + a.n, 0) / 2;
  /* equipos, de los resultados */
  const res = {}; for (const t of tids) res[t] = { cs: 0, ns: 0, gf: 0, gc: 0 };
  let hw = 0, dw = 0, aw = 0, goals = 0, big = null;
  for (const m0 of P) { const m = off(m0); goals += m.hs + m.as; m.hs > m.as ? hw++ : m.hs < m.as ? aw++ : dw++;
    if (!big || Math.abs(m.hs - m.as) > Math.abs(big.hs - big.as) || (Math.abs(m.hs - m.as) === Math.abs(big.hs - big.as) && m.hs + m.as > big.hs + big.as)) big = m;
    for (const [t, gf, gc] of [[m.h, m.hs, m.as], [m.a, m.as, m.hs]]) { const r = res[t]; if (!r) continue; r.gf += gf; r.gc += gc; if (!gc) r.cs++; if (!gf) r.ns++; } }
  const tRes = (f, asc) => { const rows = tids.map(t => ({ t, name: T[t].name, v: f(res[t], t) })).sort((a, b) => asc ? a.v - b.v : b.v - a.v); const max = Math.max(...rows.map(r => r.v)) || 1; return ranked(rows.map(r => ({ ...r, bar: 100 * r.v / max })), 'v'); };
  const pct = n => Math.round(100 * n / (P.length || 1)) + '%';
  const fair = tids.map(t => ({ t, name: T[t].name, y: (teamCards[t] || {}).y || 0, r: (teamCards[t] || {}).r || 0 })).map(r => ({ ...r, v: r.y + 3 * r.r, sub: `${r.y} amarillas · ${r.r} rojas` })).sort((a, b) => a.v - b.v);
  const sinEv = P.filter(m => off(m).hs + off(m).as > 0 && !(m.ev || []).some(e => ['goal', 'pen', 'og'].includes(e[1])));
  const noEv = sinEv.length ? `No incluye ${sinEv.map(m => `${esc(T[m.h].name)} ${off(m).hs}-${off(m).as} ${esc(T[m.a].name)} (J${m.r})`).join(', ')}.` : '';
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const srcNote = 'Fuente: datos de cada partido; se actualiza solo.';
  const noApi = '<p class="hint">Todavía no hay datos. Se cargan automáticamente en las próximas horas.</p>';
  return `
  <section class="panel"><div class="ph2"><h2>Estadísticas · Apertura 2026</h2></div>
    <div class="kpis">
      ${kpi(goals, 'goles en ' + P.length + ' partidos')}${kpi((goals / (P.length || 1)).toFixed(2), 'goles por partido')}
      ${kpi(pct(hw), 'ganó el local')}${kpi(pct(dw), 'empates')}${kpi(pct(aw), 'ganó la visita')}
      ${big ? kpi(`${big.hs}-${big.as}`, `mayor goleada: ${esc(T[big.h].name)} vs ${esc(T[big.a].name)}, J${big.r}`) : ''}
    </div></section>
  <h2 class="shead">Jugadores</h2>
  <div class="sgrid">
    ${sCard('Goleadores', sRows(goles.slice(0, nG)) + (goles.length > 5 ? `<button class="more sall" data-allg>${S.allg ? 'Ver menos' : `Ver los ${goles.length}`}</button>` : ''))}
    ${(() => { const tid = n => +Object.keys(T).find(k => T[k].name === n); const L = (ASIS.lista || []).filter(x => tid(x.equipo)).sort((a, b) => b.a - a.a);
      const R = ranked(L.map(x => ({ name: x.jugador, t: tid(x.equipo), v: x.a })), 'v');
      return L.length ? sCard('Asistidores', sRows(S.alla ? R : R.slice(0, 5)) + (R.length > 5 ? `<button class="more sall" data-alla>${S.alla ? 'Ver menos' : `Ver los ${R.length}`}</button>` : ''), `Los asistidores se actualizan al final de cada jornada · Última actualización: ${esc(ASIS.actualizado || '')}`) : ''; })()}
    ${sCard('Dobletes y tripletes', dobletes.length ? sRows(dobletes) : '<p class="hint">Nadie todavía.</p>')}
  </div>
  <h2 class="shead">Equipos</h2>
  <div class="sgrid">
    ${sCard('Vallas invictas', sRows(tRes(r => r.cs)))}
    ${sCard('Partidos sin anotar', sRows(tRes(r => r.ns)))}
    ${sCard('Goles en el segundo tiempo', sRows(tids.map(t => ({ t, name: T[t].name, v: (half[t] || {}).b || 0, sub: `${(half[t] || {}).a || 0} en el 1.º · ${(half[t] || {}).b || 0} en el 2.º` })).sort((a, b) => b.v - a.v).map((r, i, A) => ({ ...r, bar: 100 * r.v / (A[0].v || 1) }))), noEv)}
    ${sCard('Goles del minuto 76 en adelante', sRows(ranked(tids.map(t => ({ t, name: T[t].name, v: lateG[t] || 0 })).sort((a, b) => b.v - a.v), 'v').map((r, i, A) => ({ ...r, bar: 100 * r.v / (A[0].v || 1) }))), noEv)}
  </div>`;
}
const cardRow = n => `<span class="cards" aria-label="${n} amarillas">${Array.from({length:n}, () => '<i class="ico yc"></i>').join('')}</span>`;
function yellowsHtml(n) {
  return `<ol class="list">${topYellow.slice(0, n).map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)} · última en J${y.last}${suspendedNext.some(x => x.name === y.name && x.t === y.t) ? ' · <b style="color:var(--red,#d33)">suspendido J' + (y.last + 1) + '</b>' : y.n >= YELLOW_LIMIT ? ' · ya cumplió suspensión' : ''}</span></span>${y.cycle === YELLOW_LIMIT - 1 ? '<span class="chip cap4">En capilla</span>' : ''}${cardRow(y.n)}<span class="big" style="font-size:22px;min-width:22px;text-align:right">${y.n}</span></li>`).join('')}</ol>`;
}

// El bloque de la jornada solo va en Inicio; en las otras pestañas queda solo la franja en vivo (si hay)
function syncBoard() {
  const home = S.view === 'inicio';
  const sinFranja = ['ascenso', 'legionarios', 'sele'].includes(S.view);   // pestañas que no son de la Primera
  document.querySelectorAll('[data-home]').forEach(el => { el.hidden = !home; });
  document.querySelector('.board').hidden = sinFranja || (!home && document.getElementById('live').hidden);
}
function renderView() {
  syncBoard();
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === S.view ? 'page' : 'false'));
  const v = document.getElementById('view');
  const seg = `<div class="seg" role="group" aria-label="Tipo de tabla">${[['total','General'],['home','Local'],['away','Visita']].map(([k,l]) => `<button data-t="${k}" aria-pressed="${S.tmode === k}">${l}</button>`).join('')}</div>`;
  if (S.view === 'inicio') {
    v.innerHTML = `<div class="cols">
      <div class="wide"><section class="panel"><div class="ph2"><h2>Tabla de posiciones</h2>${seg}</div>${tableHtml(S.tmode)}</section></div>
      <div class="side">
        <section class="panel"><div class="ph2"><h2>Goleadores</h2><button class="more" data-go="estadisticas">Ver todos →</button></div>${scorersHtml(5)}</section>
        <section class="panel"><div class="ph2"><h2>Disciplina</h2><button class="more" data-go="disciplina">Ver todo →</button></div>
          <p class="lead">Suspendidos para su próximo partido</p>
          ${suspendedNext.length ? `<ol class="list">${suspendedNext.map(s => `<li>${crest(s.t)}<span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)}</span></span><span class="chip sus">${esc(s.why)}</span></li>`).join('')}</ol>` : '<p class="hint">Nadie.</p>'}
          <p class="lead" style="margin-top:12px">En capilla (4 amarillas)</p>
          ${onFour.length ? `<ol class="list">${onFour.map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)}</span></span><span class="chip cap4">4</span></li>`).join('')}</ol>` : '<p class="hint">Nadie.</p>'}
        </section>
      </div></div>`;
  } else if (S.view === 'tabla') {
    v.innerHTML = `<section class="panel"><div class="ph2"><h2>Tabla de posiciones</h2>${seg}</div>${tableHtml(S.tmode)}</section>`;
  } else if (S.view === 'estadisticas') {
    v.innerHTML = statsHtml();
    v.querySelectorAll('[data-allg]').forEach(b => b.onclick = () => { S.allg = !S.allg; renderView(); });
    v.querySelectorAll('[data-alla]').forEach(b => b.onclick = () => { S.alla = !S.alla; renderView(); });
  } else if (S.view === 'sele') {
    renderSele(v);
  } else if (S.view === 'ascenso') {
    renderAscenso(v);
  } else if (S.view === 'legionarios') {
    renderLegio(v);
  } else if (S.view === 'copa') {
    v.innerHTML = copaHtml();
    v.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { S.cf = b.dataset.cf; renderView(); });
    v.querySelectorAll('[data-intl]').forEach(b => b.onclick = () => {
      S.cid = S.cid === +b.dataset.intl ? null : +b.dataset.intl; renderView();
      if (S.cid) document.getElementById('cdetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    const fair = Object.entries(teamCards).map(([t,c]) => ({ t:+t, ...c })).sort((a,b) => (b.y + b.r*3) - (a.y + a.r*3));
    v.innerHTML = `<div class="cols">
      <div class="wide">
        <section class="panel"><div class="ph2"><h2>Suspendidos para su próximo partido</h2></div>
          
          ${suspendedNext.length ? `<ol class="list">${suspendedNext.map(s => `<li><span class="chip sus">${esc(s.why)}</span>${crest(s.t)}<span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)} · se pierde ${s.nexts && s.nexts.length ? s.nexts.map(n => `J${n.r} vs ${esc(T[n.h === s.t ? n.a : n.h].name)}`).join(' y ') : 'el próximo partido'}</span></span></li>`).join('')}</ol>` : '<p class="hint">Nadie suspendido para la próxima jornada.</p>'}
        </section>
        <section class="panel"><div class="ph2"><h2>En capilla</h2></div>
          
          ${onFour.length ? `<ol class="list">${onFour.map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)}</span></span>${cardRow(4)}</li>`).join('')}</ol>` : '<p class="hint">Nadie con 4 amarillas.</p>'}
        </section>
        <section class="panel"><div class="ph2"><h2>Amarillas en el torneo</h2></div>
          
          ${yellowsHtml(topYellow.filter(y => y.n >= 3).length)}</section></div>
      <div class="side">
        <section class="panel"><div class="ph2"><h2>Expulsados</h2></div>
          <ol class="list">${reds.map(r => `<li><span class="ico rc" aria-hidden="true"></span>${crest(r.t)}<span class="nm"><b>${esc(r.name)}</b><span>${esc(T[r.t].name)} · J${r.r} vs ${esc(T[r.opp].name)}, min ${esc(r.time)}'</span></span></li>`).join('')}</ol></section>
        <section class="panel"><div class="ph2"><h2>Tarjetas por equipo</h2></div>
          <div class="tw"><table><thead><tr><th class="l">Equipo</th><th>Amarillas</th><th>Rojas</th></tr></thead>
          <tbody>${fair.map(f => `<tr><td class="l"><span class="tn">${crest(f.t)}${esc(T[f.t].name)}</span></td><td>${f.y}</td><td>${f.r}</td></tr>`).join('')}</tbody></table></div></section>
      </div></div>`;
  }
  v.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tmode = b.dataset.t; renderView(); });
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
}
/* ---------- Copa Centroamericana ---------- */
const ROUND_ES = { 'Play-in': 'Repechaje a la Copa de Campeones', 'Final': 'Final', 'Semi-finals': 'Semifinales', 'Quarter-finals': 'Cuartos de final', 'Round of 16': 'Octavos de final', 'Group Stage': 'Fase de grupos' };
const ROUND_ORDER = ['Final', 'Semi-finals', 'Play-in', 'Quarter-finals', 'Round of 16', 'Group Stage'];
const TICOS = new Set(Object.keys(T).map(Number));
function copaHtml() {
  const list = (D.intl || []).filter(m => /central american/i.test(m.comp || ''));
  if (!list.length) return '<section class="panel"><h2 class="ch">Copa Centroamericana</h2><p class="hint">Todavía no hay partidos de equipos ticos en este torneo.</p></section>';
  // Highlightly llama "Final" a series que no lo son (p. ej. el repechaje a Concachampions):
  // si un equipo de esa serie fue eliminado en una ronda anterior, es repechaje.
  const lostIn = r => { const out = new Set(); const ties = {};
    list.filter(m => m.round === r && m.hs != null).forEach(m => { const k = [m.hId, m.aId].sort().join('-'); (ties[k] ||= []).push(m); });
    Object.values(ties).forEach(legs => { if (legs.length < 2) return; const x = legs[0].hId; let gx = 0, gy = 0;
      legs.forEach(l => { if (l.hId === x) { gx += l.hs; gy += l.as; } else { gx += l.as; gy += l.hs; } });
      if (gx !== gy) out.add(gx < gy ? x : legs[0].aId); }); return out; };
  const outQF = lostIn('Quarter-finals');
  const fixRound = m => m.round === 'Final' && (outQF.has(m.hId) || outQF.has(m.aId)) ? 'Play-in' : m.round;
  const withLive = list.map(m => ({ ...m, round: fixRound(m) })).map(m => {
    const lv = LIVE.find(x => x.id === m.id && x.started && x.score);
    if (!lv) return m;
    const [hs, as] = lv.score.split(' - ').map(Number);
    return { ...m, hs, as, live: !lv.finished, clock: lv.clock, s: lv.finished ? 'Finished' : lv.status };
  });
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="crest ph" aria-hidden="true">${esc(t.ab)}</span>`;
  const isPlayed = m => m.hs !== undefined && m.hs !== null;
  const status = m => m.live ? `<span class="lv">EN VIVO ${m.clock ?? ''}'</span>` : isPlayed(m) ? 'Final' : fmtTime(m.d);
  const line = (t, tid, g, lose) => `<span class="row ${lose ? 'lose' : ''}${TICOS.has(tid) ? ' tico' : ''}">${cr(t)}<span>${esc(t.name)}</span><span class="sc">${g ?? ''}</span></span>`;
  const card = m => { const p = isPlayed(m) && !m.live; return `<button type="button" class="cc" data-intl="${m.id}" aria-pressed="${S.cid === m.id}">
    <span class="meta"><span>${esc(fmtDay(m.d))}</span><span>${status(m)}</span></span>
    ${line(m.h, m.hId, isPlayed(m) ? m.hs : '', p && m.hs < m.as)}${line(m.a, m.aId, isPlayed(m) ? m.as : '', p && m.as < m.hs)}</button>`; };
  const byRound = {};
  for (const m of withLive) (byRound[m.round] ||= []).push(m);
  const order = Object.keys(byRound).sort((a, b) => (ROUND_ORDER.indexOf(a) + 1 || 99) - (ROUND_ORDER.indexOf(b) + 1 || 99));
  const section = r => {
    const ms = byRound[r].sort((a, b) => new Date(a.d) - new Date(b.d));
    if (/group/i.test(r)) return `<section class="panel"><h2 class="ch">${esc(ROUND_ES[r] || r)}</h2><div class="cgrid">${ms.map(card).join('')}</div></section>`;
    // eliminatorias: agrupar ida y vuelta por pareja y sacar el global
    const ties = {};
    for (const m of ms) (ties[[m.hId, m.aId].sort().join('-')] ||= []).push(m);
    return `<section class="panel"><h2 class="ch">${esc(ROUND_ES[r] || r)}</h2><div class="ties">${Object.values(ties).map(legs => {
      const [x, y] = [legs[0].hId, legs[0].aId];
      const tx = legs[0].h, ty = legs[0].a;
      let gx = 0, gy = 0, done = 0;
      for (const l of legs) if (isPlayed(l)) { done++; if (l.hId === x) { gx += l.hs; gy += l.as; } else { gx += l.as; gy += l.hs; } }
      const agg = done ? `<p class="agg">Global: <b>${esc(tx.name)} ${gx}–${gy} ${esc(ty.name)}</b>${done < legs.length ? ' · falta la vuelta' : ''}</p>` : '';
      return `<div class="tie">${legs.map((l, i) => `<div><p class="leg">${legs.length > 1 ? (i ? 'Vuelta' : 'Ida') : 'Partido'}</p>${card(l)}</div>`).join('')}${agg}</div>`;
    }).join('')}</div></section>`;
  };
  const sel = withLive.find(m => m.id === S.cid);
  return `<div class="copa"><div class="chead"><h1>Copa Centroamericana</h1><span>Concacaf ${esc(String(D.league?.season || ''))} · fase final y los partidos de los ticos · tocá un partido para ver el en vivo o la previa</span></div>
    <div id="cdetail">${sel ? intlDetailHtml(sel) : ''}</div>${order.map(section).join('')}
    </div>`;
}
function intlDetailHtml(m) {
  const lv = LIVE.find(x => x.id === m.id && x.started);
  const tm = (t, tid) => ({ ...t, tid });
  const H = tm(m.h, m.hId), A = tm(m.a, m.aId);
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="">` : `<span class="crest ph" aria-hidden="true">${esc(t.ab)}</span>`;
  const head = mid => `<div class="dscore"><div class="dteam r"><span>${esc(H.name)}</span>${cr(H)}</div><div>${mid}</div><div class="dteam">${cr(A)}<span>${esc(A.name)}</span></div></div>`;
  const roundName = ROUND_ES[m.round] || m.round;
  if (lv) {
    const [hs, as] = (lv.score || '0 - 0').split(' - ').map(Number);
    const ev = reconcile(lv.events, hs, as, !lv.finished);
    const sts = lv.stats && lv.stats.length === 2 ? lv.stats : null;
    const hi = sts && sts[0].t === m.hId ? 0 : 1;
    const bars = sts ? STATS.map(([k, lab, f = v => v]) => { const h = sts[hi].s[k], a = sts[1 - hi].s[k]; if (h === undefined) return ''; const tot = (h + a) || 1;
      return `<div class="sbar"><div class="lab"><span>${f(h)}</span><span>${lab}</span><span>${f(a)}</span></div><div class="bars"><i style="flex:${h/tot || .001};background:var(--accent)"></i><i style="flex:${a/tot || .001};background:var(--draw)"></i></div></div>`; }).join('') : '';
    return `<div class="detail cd">${head(`<div class="dnum">${hs} – ${as}</div>`)}
      <div class="dmeta">${lv.finished ? 'Final' : /half time/i.test(lv.status) ? 'Entretiempo' : `EN VIVO ${lv.clock ?? ''}'`} · ${esc(roundName)} · ${esc(fmtDay(m.d))}</div>
      <div class="dcols"><div><h3>Minuto a minuto</h3>${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Sin eventos todavía.</p>'}</div>
      ${bars ? `<div><h3>Estadísticas</h3>${bars}</div>` : ''}</div></div>`;
  }
  if (m.hs != null) {
    const ev = sortEvents({ events: reconcile(m.ev || [], m.hs, m.as) }).events;
    const sts = m.stats && m.stats.length === 2 ? m.stats : null, hi = sts && sts[0].t === m.hId ? 0 : 1;
    const bars = sts ? STATS.map(([k, lab, f = v => v]) => { const h = sts[hi].s[k], a = sts[1 - hi].s[k]; if (h === undefined || h === null) return ''; const tot = (h + a) || 1;
      return `<div class="sbar"><div class="lab"><span>${f(h)}</span><span>${lab}</span><span>${f(a)}</span></div><div class="bars"><i style="flex:${h/tot || .001};background:var(--accent)"></i><i style="flex:${a/tot || .001};background:var(--draw)"></i></div></div>`; }).join('') : '';
    return `<div class="detail cd">${head(`<div class="dnum">${m.hs} – ${m.as}</div>`)}<div class="dmeta">Final · ${esc(roundName)} · ${esc(fmtDay(m.d))}${venueHtml(m.venue || '')}</div>
      ${m.ev ? `<div class="dcols"><div><h3>Minuto a minuto</h3>${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Sin goles, tarjetas ni cambios registrados.</p>'}</div>
      ${bars ? `<div><h3>Estadísticas</h3>${bars}</div>` : ''}</div>` : '<p class="hint" style="margin-top:12px">El minuto a minuto de este partido se carga en unos minutos.</p>'}</div>`;
  }
  // previa
  const P = PREVIA[m.id];
  if (P === undefined) { PREVIA[m.id] = null; fetch('/api/previa?id=' + m.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { PREVIA[m.id] = j || {}; if (S.view === 'copa' && S.cid === m.id) renderView(); }); }
  const OL = (P && P.lineups) || MANUAL[m.id], off_ = !!OL;
  const F = D.form || {};
  // Oficial si ya salió; si no, la última alineación del equipo (de cualquier torneo); para ticos, también la de la liga
  const side = (tid, key) => off_ ? { formation: OL[key].formation, rows: OL[key].rows } : (F[tid]?.lineup || (TICOS.has(tid) ? lastLineup(tid) : null));
  const HL = side(m.hId, 'home'), AL = side(m.aId, 'away');
  const pr = P && P.predictions?.prematch?.length ? P.predictions.prematch[P.predictions.prematch.length - 1].probabilities : null;
  const prob = pr ? (() => { const h = parseFloat(pr.home), d = parseFloat(pr.draw), a = parseFloat(pr.away);
    return `<div class="pred"><div class="bar"><i style="flex:${h};background:var(--accent)"></i><i style="flex:${d};background:var(--draw)"></i><i style="flex:${a};background:var(--away)"></i></div>
      <div class="lab"><span>${esc(H.name)} <b>${Math.round(h)}%</b></span><span>Empate <b>${Math.round(d)}%</b></span><span>${esc(A.name)} <b>${Math.round(a)}%</b></span></div></div>`; })() : '';
  const hist = (D.h2h || {})[[m.hId, m.aId].sort((a, b) => a - b).join('-')] || [];
  const ida = (D.intl || []).filter(x => x.id !== m.id && x.hs != null && [x.hId, x.aId].sort().join() === [m.hId, m.aId].sort().join());
  // Últimos resultados: Copa o liga local, con un botón para cambiar
  const clean = n => String(n || '').replace(/^(CD|CS|LD|AD|FC|CF|SD|CSD|Club|Deportivo)\s+/i, '').replace(/\s+(FC|CF|SC)$/i, '');
  const isCup = c => /central american|concacaf|champions cup/i.test(c || '');
  const isLocal = c => !isCup(c) && !/friendl|amistos|leagues cup/i.test(c || '');
  const recentOf = tid => {
    let xs = (F[tid]?.recent || []).map(x => ({ d: x.d, home: x.hId === tid, opp: x.hId === tid ? x.a : x.h, gf: x.hId === tid ? x.hs : x.as, ga: x.hId === tid ? x.as : x.hs, c: x.comp }));
    if (!xs.length && TICOS.has(tid)) xs = [...M.filter(x => played(x) && (x.h === tid || x.a === tid)).map(x => { const o = off(x), home = x.h === tid; return { d: x.d, home, opp: T[home ? x.a : x.h].name, gf: home ? o.hs : o.as, ga: home ? o.as : o.hs, c: 'Liga' }; }),
      ...(D.intl || []).filter(x => x.hs != null && (x.hId === tid || x.aId === tid)).map(x => { const home = x.hId === tid; return { d: x.d, home, opp: home ? x.a.name : x.h.name, gf: home ? x.hs : x.as, ga: home ? x.as : x.hs, c: 'Concacaf Central American Cup' }; })]
      .sort((a, b) => new Date(b.d) - new Date(a.d));
    if (!F[tid]?.recent?.length && !TICOS.has(tid)) xs = (D.intl || []).filter(x => x.hs != null && (x.hId === tid || x.aId === tid)).map(x => { const home = x.hId === tid; return { d: x.d, home, opp: home ? x.a.name : x.h.name, gf: home ? x.hs : x.as, ga: home ? x.as : x.hs, c: 'Concacaf Central American Cup' }; }).reverse();
    return xs.filter(x => S.cf === 'liga' ? isLocal(x.c) : isCup(x.c)).slice(0, 5);
  };
  const recent = tid => { const t = tid === m.hId ? H : A, xs = recentOf(tid);
    return `<div><h3>${esc(t.name)}</h3>${xs.length ? `<ul class="plist">${xs.map(x => { const r = x.gf > x.ga ? 'W' : x.gf < x.ga ? 'L' : 'D';
      return `<li><span class="res ${r}">${({W:'G',D:'E',L:'P'})[r]}</span>${x.home ? 'vs' : 'en'} ${esc(clean(x.opp))}<span class="x">${x.gf}–${x.ga} · ${esc(new Date(x.d).toLocaleDateString('es-CR', { ...tz, day: 'numeric', month: 'short' }))}</span></li>`; }).join('')}</ul>` : '<p class="hint">Sin partidos cargados.</p>'}</div>`; };
  const cfSeg = `<div class="seg" role="group" aria-label="Últimos resultados">${[['copa', 'Copa'], ['liga', 'Liga local']].map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${(S.cf || 'copa') === k}">${l}</button>`).join('')}</div>`;
  const luFrom = L => L && L.vs ? `vs ${esc(clean(L.vs))}, ${esc(new Date(L.d).toLocaleDateString('es-CR', { ...tz, day: 'numeric', month: 'short' }))}` : '';
  return `<div class="detail cd">${head(m.tbd ? '<div class="dnum" style="font-size:20px;white-space:nowrap">Hora por definir</div>' : `<div class="dnum" style="font-size:40px">${esc(fmtTime(m.d))}</div>`)}
    <div class="dmeta">Previa · ${esc(roundName)} · ${esc(fmtDay(m.d))}${venueHtml(m.venue || (P && P.venue?.name) || '')}</div>${prob}
    <div class="pv"><section class="pv-lu" style="${kitVars(H.name, A.name)}"><h3>Alineaciones</h3><p class="lead">${off_ ? '<span class="chip ok">Alineación oficial</span>' : '<span class="chip">Probable</span> la última que usó cada equipo. La oficial sale cerca del pitazo.'}</p>
      <div class="fbar"><span><i class="dot h"></i> ${esc(H.name)}</span><span class="f">${esc(HL?.formation || '')}</span></div>${pitchHtml(HL, AL)}
      <div class="fbar"><span><i class="dot a"></i> ${esc(A.name)}</span><span class="f">${esc(AL?.formation || '')}</span></div>
      ${!off_ && (HL?.vs || AL?.vs) ? `<p class="foot">${HL?.vs ? `${esc(H.name)}: ${luFrom(HL)}. ` : ''}${AL?.vs ? `${esc(A.name)}: ${luFrom(AL)}.` : ''}</p>` : ''}</section>
    <div class="pv-data">
      ${ida.length ? `<section><h3>Partido de ida</h3><ul class="plist">${ida.map(x => `<li>${esc(fmtDay(x.d))} · ${esc(x.h.name)} <b>${x.hs}–${x.as}</b> ${esc(x.a.name)}</li>`).join('')}</ul></section>` : ''}
      <section><div class="ph2" style="margin-bottom:6px"><h3 style="margin:0">Últimos resultados</h3>${cfSeg}</div><div class="two">${recent(m.hId)}${recent(m.aId)}</div></section>
      ${hist.length ? `<section><h3>Historial entre ellos</h3><ul class="plist">${hist.map(x => `<li><span class="x" style="margin:0;min-width:84px;text-align:left">${esc(new Date(x.d).toLocaleDateString('es-CR', { ...tz, day: 'numeric', month: 'short', year: 'numeric' }))}</span>${esc(x.hId === m.hId ? H.name : x.hId === m.aId ? A.name : x.h)} <b>${x.hs}–${x.as}</b> ${esc(x.aId === m.aId ? A.name : x.aId === m.hId ? H.name : x.a)}<span class="x">${esc(COMP[x.comp] || x.comp || '')}</span></li>`).join('')}</ul>
        <p class="foot">${(() => { let w1 = 0, w2 = 0, d = 0; hist.forEach(x => { const g1 = x.hId === m.hId ? x.hs : x.as, g2 = x.hId === m.hId ? x.as : x.hs; g1 > g2 ? w1++ : g1 < g2 ? w2++ : d++; }); return `Últimos ${hist.length}: ${esc(H.name)} ganó ${w1}, ${esc(A.name)} ganó ${w2}, ${d} empates.`; })()}</p></section>` : ''}
      
    </div></div></div>`;
}
/* ---------- Legionarios: se actualiza una vez al día (scripts/legionarios.mjs) ---------- */
let LG = null, LGpos = 'Todos', LGsel = null, LGall = {};
const nrm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const LPOS = ['Todos', 'Portero', 'Defensa', 'Mediocampista', 'Extremo', 'Delantero'];
const isFin = s => /finish|award|after|penalt/i.test(s || '');
function scoreOf(m) { const [h, a] = String(m.score || '').split(' - ').map(Number); return Number.isFinite(h) && Number.isFinite(a) ? [h, a] : null; }
// resultado desde el punto de vista del club del jugador: W, D, L
function resFor(m, tid) { const sc = scoreOf(m); if (!sc || !isFin(m.s)) return null; const [mine, opp] = m.h.id == tid ? sc : [sc[1], sc[0]]; return mine > opp ? 'W' : mine < opp ? 'L' : 'D'; }
// lo que hizo el jugador en ese partido, según el minuto a minuto (goles, tarjetas, cambios)
function didIn(m, p) {
  const sur = nrm(p.nombre).split(' ').slice(-1)[0], first = nrm(p.nombre)[0];
  const me = n => { const x = nrm(n); return x && x.includes(sur) && (x.startsWith(first) || !/^[a-z]\.? /.test(x) || x.split(' ').length === 1); };
  const out = [];
  for (const e of (m.ev || [])) {
    if (e.team != p.teamId) continue;
    const t = String(e.t).replace(/\D+$/, '');
    if (/own/i.test(e.type)) continue;
    if (/goal|penalty/i.test(e.type) && !/miss/i.test(e.type) && me(e.player)) out.push(['g', `Gol ${t}'`]);
    else if (/goal/i.test(e.type) && me(e.assist)) out.push(['a', `Asistencia ${t}'`]);
    else if (/yellow/i.test(e.type) && me(e.player)) out.push(['yc', `Amarilla ${t}'`]);
    else if (/red/i.test(e.type) && me(e.player)) out.push(['rc', `Roja ${t}'`]);
    else if (/subst/i.test(e.type) && me(e.sub)) out.push(['in', `Entró ${t}'`]);
    else if (/subst/i.test(e.type) && me(e.player)) out.push(['out', `Salió ${t}'`]);
  }
  return out;
}
const RES = { W: 'Ganó', D: 'Empató', L: 'Perdió' };
function lgMatchLine(m, p, withDate = true) {
  const home = m.h.id == p.teamId, opp = home ? m.a : m.h, sc = scoreOf(m), r = resFor(m, p.teamId);
  const did = didIn(m, p);
  return `<li class="lm">${withDate ? `<span class="d">${esc(fmtDay(m.d))}</span>` : ''}
    <span class="o">${home ? 'vs' : 'en'} ${opp.logo ? `<img class="crest" src="${esc(opp.logo)}" alt="" loading="lazy">` : ''}<b>${esc(opp.name)}</b> <small>${esc(m.comp || '')}</small></span>
    ${r ? `<span class="r ${r}">${RES[r]} ${home ? sc[0] : sc[1]}–${home ? sc[1] : sc[0]}</span>` : `<span class="r">${esc(fmtTime(m.d))}</span>`}
    ${did.length ? `<span class="did">${did.map(([k, l]) => `<span class="tag ${k}">${esc(l)}</span>`).join('')}</span>` : ''}</li>`;
}
function renderLegio(v) {
  if (!LG) {
    v.innerHTML = '<section class="panel"><p class="hint">Cargando legionarios…</p></section>';
    if (LG === null) { LG = false; fetch('/data/legionarios.json', { cache: 'no-cache' }).then(r => r.json()).then(j => { LG = j; }).catch(() => { LG = { players: [], clubs: {} }; }).then(() => { if (S.view === 'legionarios') renderView(); }); }
    return;
  }
  const P = LG.players || [], C = LG.clubs || {}, now = Date.now();
  const fx = p => (C[p.teamId]?.fixtures || []);
  // agenda: partidos de sus clubes desde hace 3 días hasta dentro de 7, en hora de Costa Rica
  const ag = [];
  for (const p of P) for (const m of fx(p)) { const t = new Date(m.d).getTime(); if (t > now - 4 * 864e5 && t < now + 5 * 864e5 && !/postp|cancel/i.test(m.s || '')) ag.push([m, p]); }
  // Primero lo más reciente que se jugó (o se está jugando); después lo que viene, del más cercano al más lejano
  const started = ([m]) => new Date(m.d).getTime() <= now;
  const played_ = ag.filter(started).sort((a, b) => new Date(b[0].d) - new Date(a[0].d));
  const coming = ag.filter(x => !started(x)).sort((a, b) => new Date(a[0].d) - new Date(b[0].d));
  const AGMAX = 8;
  const agCard = ([m, p]) => {
      const home = m.h.id == p.teamId, opp = home ? m.a : m.h, sc = scoreOf(m), r = resFor(m, p.teamId), did = didIn(m, p);
      const club = C[p.teamId]?.name || p.club;
      return `<button type="button" class="ag" data-lp="${esc(p.nombre)}"><span class="when"><span>${esc(fmtDay(m.d))} · ${esc(fmtTime(m.d))}</span><small>${esc(m.comp || '')}</small></span>
        <span class="who"><span class="flag" aria-hidden="true">${p.bandera || ''}</span>${esc(p.nombre)}</span>
        <span class="vs">${esc(club)} ${home ? 'vs' : 'en'} ${esc(opp.name)}</span>
        ${r ? `<span class="agres"><span class="tag ${r}">${RES[r]} ${home ? sc[0] : sc[1]}–${home ? sc[1] : sc[0]}</span>${did.map(([k, l]) => `<span class="tag ${k}">${esc(l)}</span>`).join('')}</span>` : started([m]) ? '<span class="agres">Resultado en la próxima actualización</span>' : ''}</button>`;
  };
  const group = (list, key, title) => list.length ? `<h3 class="agh">${title}</h3><div class="agenda">${list.slice(0, LGall[key] ? list.length : AGMAX).map(agCard).join('')}</div>${list.length > AGMAX ? `<button type="button" class="more lgmore" data-lgall="${key}">${LGall[key] ? 'Ver menos' : `Ver los ${list.length}`}</button>` : ''}` : '';
  const agHtml = ag.length ? group(played_, 'res', 'Últimos resultados') + group(coming, 'next', 'Próximos partidos')
    : '<p class="hint">Sin partidos de sus clubes en estos días' + '.</p>';
  const ini = n => n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('');
  const form = p => fx(p).filter(m => isFin(m.s) && new Date(m.d) < now).slice(-5).map(m => resFor(m, p.teamId)).filter(Boolean);
  const card = p => {
    const s = p.stats, gk = p.pos === 'Portero', f = form(p), club = C[p.teamId];
    const n = k => s ? (s[k] ?? 0) : '–';
    return `<button type="button" class="pc" data-lp="${esc(p.nombre)}" aria-expanded="${LGsel === p.nombre}">
      <span class="row1">${p.foto ? `<img class="av" src="${esc(p.foto)}" alt="" loading="lazy">` : `<span class="av" aria-hidden="true">${esc(ini(p.nombre))}</span>`}<span class="nm"><b>${esc(p.nombre)}</b><span>${esc(p.pos)}</span></span></span>
      <span class="club">${club?.logo ? `<img class="crest" src="${esc(club.logo)}" alt="" loading="lazy">` : `<span class="flag" aria-hidden="true">${p.bandera || ''}</span>`}${esc(p.club)}${p.nota ? ` <small>(${esc(p.nota)})</small>` : ''} <small>· ${esc(p.pais)}</small></span>
      ${!s ? '<span class="nostats">La API todavía no trae sus números de temporada. Abajo, los resultados de su club.</span>' : ''}
      <span class="stats"${!s ? ' hidden' : ''}><span><b>${n('games')}</b><i>PJ</i></span>${gk ? `<span><b>${n('cleanSheets')}</b><i>Valla inv.</i></span><span><b>${n('conceded')}</b><i>Recibidos</i></span>` : `<span><b>${n('goals')}</b><i>Goles</i></span><span><b>${n('assists')}</b><i>Asist.</i></span>`}<span><b>${n('minutes')}</b><i>Min</i></span></span>
      <span class="last">${f.length ? `Club, últimos ${f.length}: ${f.map(r => `<i class="dot ${r}" title="${RES[r]}"></i>`).join('')}` : 'Club: sin partidos cargados todavía'}</span>
    </button>`;
  };
  const list = P.filter(p => LGpos === 'Todos' || p.pos === LGpos);
  const sel = P.find(p => p.nombre === LGsel);
  const detail = sel ? (() => {
    const s = sel.stats, past = fx(sel).filter(m => new Date(m.d) < now).slice(-8).reverse(), next = fx(sel).filter(m => new Date(m.d) >= now).slice(0, 3);
    return `<section class="panel lpd" id="lpdetail"><div class="ph2"><h2>${esc(sel.nombre)}</h2><button class="more" data-lpclose>Cerrar ✕</button></div>
      <p class="lead">${esc(sel.pos)} · ${esc(sel.club)}${sel.nota ? ` (${esc(sel.nota)})` : ''} · ${esc(sel.pais)} ${sel.bandera || ''}</p>
      ${s ? `${s.season ? `<p class="lead" style="margin:0 0 8px">Temporada ${esc(s.season)} con ${esc(sel.club)}</p>` : ''}<div class="kv">${[['Partidos', s.games], ['Minutos', s.minutes], ...(sel.pos === 'Portero' ? [['Vallas invictas', s.cleanSheets], ['Goles recibidos', s.conceded]] : [['Goles', s.goals], ['Asistencias', s.assists]]), ['Amarillas', s.yc], ['Rojas', s.rc]].map(([k, x]) => `<span><b>${x ?? 0}</b><i>${k}</i></span>`).join('')}</div>
        ${(s.comps || []).length > 1 ? `<p class="foot">Por torneo: ${s.comps.map(c => `${esc(c.league)} ${c.games ?? 0} PJ${c.goals ? ', ' + c.goals + (c.goals === 1 ? ' gol' : ' goles') : ''}`).join(' · ')}</p>` : ''}` : '<p class="hint">Sin estadísticas de temporada.</p>'}
      ${next.length ? `<h3>Próximos partidos</h3><ul class="lms">${next.map(m => lgMatchLine(m, sel)).join('')}</ul>` : ''}
      ${past.length ? `<h3>Últimos partidos de su club</h3><ul class="lms">${past.map(m => lgMatchLine(m, sel)).join('')}</ul>` : ''}
      <p class="foot">Goles, tarjetas y cambios salen del minuto a minuto del partido; si no aparece nada, puede que no haya jugado o que la API no tenga ese detalle para esa liga.</p></section>`;
  })() : '';
  const upd = LG.updated ? new Date(LG.updated).toLocaleString('es-CR', { ...tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  v.innerHTML = `<div class="lg">
    <div class="lgh"><h2>Legionarios</h2><span>Ticos que juegan en el exterior · ${P.length} jugadores${upd ? ` · actualizado ${esc(upd)}` : ''}</span></div>
    <section class="panel"><div class="ph2"><h2>Esta semana</h2></div><p class="lead">Partidos de sus clubes de los últimos 4 días y los próximos 5, en hora de Costa Rica. Se actualiza cada 2 horas.</p>${agHtml}</section>
    <div class="filters" role="group" aria-label="Filtrar por posición">${LPOS.map(x => `<button type="button" aria-pressed="${x === LGpos}" data-lpos="${x}">${x === 'Todos' ? 'Todos' : x + 's'}</button>`).join('')}</div>
    ${detail}
    <div class="lgrid">${list.map(card).join('')}</div>
  </div>`;
  v.querySelectorAll('[data-lpos]').forEach(b => b.onclick = () => { LGpos = b.dataset.lpos; renderView(); });
  v.querySelectorAll('[data-lp]').forEach(b => b.onclick = () => {
    LGsel = LGsel === b.dataset.lp && b.classList.contains('pc') ? null : b.dataset.lp; renderView();
    const el = document.getElementById('lpdetail');
    if (LGsel && el) { const top = el.getBoundingClientRect().top + scrollY - (document.querySelector('.top')?.offsetHeight || 0) - 12; window.scrollTo({ top, behavior: 'smooth' }); }
  });
  v.querySelectorAll('[data-lgall]').forEach(b => b.onclick = () => { LGall[b.dataset.lgall] = !LGall[b.dataset.lgall]; renderView(); });
  v.querySelector('[data-lpclose]')?.addEventListener('click', () => { LGsel = null; renderView(); });
}
/* ---------- La Sele: se actualiza a mano después de cada fecha FIFA (scripts/sele.mjs) ---------- */
let SE = null, SEsel = null, SEms = [];
/* ---------- Liga de Ascenso (manual, public/data/ascenso.json) ---------- */
let ASC = null, ASCX = {};
function loadAsc(then) {
  if (ASC === null) { ASC = false; Promise.all([fetch('/data/ascenso.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null), fetch('/data/ascenso-api.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))]).then(([j, x]) => { ASC = j || { series: [], grupos: [], equipos: {} }; ASCX = x || {}; then && then(); }); }
}
const ascH = () => {
  const E = ASC.equipos || {};
  return { E,
    cr: (k, cls = 'crest') => E[k]?.escudo ? `<img class="${cls}" src="${esc(E[k].escudo)}" alt="" loading="lazy">` : `<span class="${cls} ph" aria-hidden="true">${esc((E[k]?.nombre || k).slice(0, 3).toUpperCase())}</span>`,
    nm: k => esc(E[k]?.nombre || k),
    when: l => l.fecha ? `${fmtDay(l.fecha)} · ${fmtTime(l.fecha)}` : 'Fecha por confirmar' };
};
// equipo de la API -> nuestro equipo (nombre y escudo que pasó Falco)
const ascTeam = id => { const k = ASC && Object.keys(ASCX.ids || {}).find(k => ASCX.ids[k] === id); return k ? ASC.equipos[k] : null; };
/* Detalle del partido de Ascenso abierto desde la franja de Inicio (se abre ahí mismo, debajo de la franja) */
function renderLdet() {
  let el = document.getElementById('ldetail');
  if (!el) { el = document.createElement('div'); el.id = 'ldetail'; document.getElementById('live').after(el); }
  if (!S.ldet || S.view !== 'inicio' || !ASC) { el.innerHTML = ''; return; }
  const n = Object.entries(ASCX.series || {}).find(([, x]) => (x.legs || []).some(l => l.id === S.ldet))?.[0];
  const ser = (ASC.series || []).find(x => x.n === +n);
  if (!ser) { el.innerHTML = ''; return; }
  const h = ascH();
  el.innerHTML = ascPrevia(ascLegs(ser), h.E, h.cr, h.nm, h.when);
}
function renderAscenso(v) {
  if (!ASC) {
    v.innerHTML = '<section class="panel"><p class="hint">Cargando la Liga de Ascenso…</p></section>';
    loadAsc(() => { if (S.view === 'ascenso') renderView(); });
    return;
  }
  if (S.ascPick) { const n = Object.entries(ASCX.series || {}).find(([, x]) => (x.legs || []).some(l => l.id === S.ascPick))?.[0]; if (n) S.asel = +n; S.ascPick = null; }
  const E = ASC.equipos || {};
  const cr = (k, cls = 'crest') => E[k]?.escudo ? `<img class="${cls}" src="${esc(E[k].escudo)}" alt="" loading="lazy">` : `<span class="${cls} ph" aria-hidden="true">${esc((E[k]?.nombre || k).slice(0, 3).toUpperCase())}</span>`;
  const nm = k => esc(E[k]?.nombre || k);
  const when = l => l.fecha ? `${fmtDay(l.fecha)} · ${fmtTime(l.fecha)}` : 'Fecha por confirmar';
  const sc = x => x == null ? '' : x;
  const series = (ASC.series || []).map(s0 => {
    const s = ascLegs(s0); const i = s.ida || {}, vu = s.vuelta || {};
    const both = i.ga != null && vu.ga != null;
    const ta = (i.ga ?? 0) + (vu.ga ?? 0), tb = (i.gb ?? 0) + (vu.gb ?? 0);
    const pasa = s.pasa || (both && ta !== tb ? (ta > tb ? 'a' : 'b') : null);
    const tag = l => l.vivo ? `<span class="alive">${esc(l.vivo)}</span>` : '';
    const row = (side, k, g1, g2, tot) => `<div class="asr${pasa === side ? ' win' : pasa ? ' out' : ''}">${cr(k)}<b>${nm(k)}</b><span class="g">${sc(g1)}</span><span class="g">${sc(g2)}</span><span class="g tot">${i.ga != null ? tot : ''}</span></div>`;
    return `<article class="aser${S.asel === s.n ? ' on' : ''}" data-aser="${s.n}" role="button" tabindex="0" aria-pressed="${S.asel === s.n}"><div class="ash"><span>Serie ${s.n} · <u>${i.vivo || vu.vivo ? 'en vivo' : i.ga != null ? 'partido' : 'previa'}</u> ${tag(i)}${tag(vu)}</span><span class="cols"><i>Ida</i><i>Vuelta</i><i>Global</i></span></div>
      ${row('a', s.a, i.ga, vu.ga, ta)}${row('b', s.b, i.gb, vu.gb, tb)}
      <ul class="aleg"><li><b>Ida</b> (local ${nm(s.a)}): ${esc(when(i))}${i.estadio ? ` · ${venueHtml(i.estadio).replace(/^ · /, '')}` : ''}${i.tv ? ` · ${esc(i.tv)}` : ''}</li>
      <li><b>Vuelta</b> (local ${nm(s.b)}): ${esc(when(vu))}${vu.estadio ? ` · ${venueHtml(vu.estadio).replace(/^ · /, '')}` : ''}${vu.tv ? ` · ${esc(vu.tv)}` : ''}</li></ul>
      ${pasa ? `<p class="apasa">Avanza: <b>${nm(pasa === 'a' ? s.a : s.b)}</b></p>` : ''}</article>`;
  }).join('');
  const tabla = g => `<section class="panel"><div class="ph2"><h2>${esc(g.nombre)}</h2></div><div class="tw"><table>
    <thead><tr><th class="l">#</th><th class="l">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
    <tbody>${g.tabla.map((r, i) => { const [n, pj, gg, e, p, gf, gc, pts] = r, dg = gf - gc, k = Object.keys(E).find(k => E[k].nombre === n.replace(/\s*\*$/, ''));
      return `<tr class="${i < (g.clasifican || 0) ? 'aq' : ''}"><td class="l"><span class="pos">${i + 1}</span></td><td class="l"><span class="tn">${k ? cr(k) : ''}${esc(n)}</span></td><td>${pj}</td><td>${gg}</td><td>${e}</td><td>${p}</td><td>${gf}</td><td>${gc}</td><td>${dg > 0 ? '+' + dg : dg}</td><td class="pts">${pts}</td></tr>`; }).join('')}</tbody></table></div></section>`;
  v.innerHTML = `<section class="panel"><div class="ph2"><h2>Liga de Ascenso · ${esc(ASC.torneo || '')}</h2><span class="chip">${esc(ASC.fase || '')}</span></div>
      <div class="agrid">${series}</div><div id="adetail">${S.asel ? ascPrevia(ascLegs((ASC.series || []).find(x => x.n === S.asel)), E, cr, nm, when) : ''}</div></section>
    <h2 class="shead">Fase regular</h2>
    <div class="agrid2">${(ASC.grupos || []).map(tabla).join('')}</div>
    ${(ASC.goleadores?.lista || []).length ? (() => { let last, pos = 0; const G = ASC.goleadores.lista.slice().sort((a, b) => b.g - a.g);
      return `<h2 class="shead">Goleadores</h2><div class="sgrid"><section class="scard"><h3>Goleadores del torneo</h3><ol class="list srank">${G.map((x, i) => { if (x.g !== last) { pos = i + 1; last = x.g; }
        return `<li><span class="pos">${pos}</span>${cr(x.equipo)}<span class="nm"><b>${esc(x.jugador)}</b><span>${nm(x.equipo)}</span></span><span class="sval">${x.g}</span></li>`; }).join('')}</ol>
        <p class="foot">Última actualización: ${esc(ASC.goleadores.actualizado || '')}</p></section></div>`; })() : ''}
    `;
  v.querySelectorAll('[data-aser]').forEach(b => { const go_ = () => { const n = +b.dataset.aser; S.asel = S.asel === n ? null : n; renderView(); if (S.asel) document.getElementById('adetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    b.onclick = go_; b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go_(); } }; });
}
/* Partidos de la serie según la API (en vivo o terminados): completan los marcadores que no están puestos a mano */
function ascLegs(s0) {
  if (!s0) return s0;
  const s = { ...s0, ida: { ...(s0.ida || {}) }, vuelta: { ...(s0.vuelta || {}) } };
  const X = (ASCX.series || {})[s.n], A = (ASCX.ids || {})[s.a];
  for (const l of (X && X.legs) || []) {
    const leg = l.h.id === A ? s.ida : s.vuelta, aHome = l.h.id === A;
    const lv = LIVE.find(x => x.id === l.id && x.started);
    const sc = lv && lv.score ? lv.score.split(' - ').map(Number) : l.hs !== undefined ? [l.hs, l.as] : null;
    leg.apiId = l.id; leg.live = lv || null;
    if (leg.ga == null && sc) { leg.ga = aHome ? sc[0] : sc[1]; leg.gb = aHome ? sc[1] : sc[0]; }
    if (lv && !lv.finished) leg.vivo = /half time/i.test(lv.status) ? 'ENTRETIEMPO' : `EN VIVO ${lv.clock ?? ''}'`;
  }
  return s;
}
function ascLiveHtml(leg, local, vis, nm) {
  const lv = leg.live; if (!lv) return '';
  const ev = sortEvents({ events: (lv.events || []).map(e => e.slice()) }).events || [];
  const st = lv.stats || [], ph = st[0]?.s?.Possession, pa = st[1]?.s?.Possession;
  const pos = ph != null && pa != null ? `<section><h3>Posesión</h3><div class="apos"><b>${Math.round(ph * 100)}%</b><span class="bar"><i style="width:${ph * 100}%"></i></span><b>${Math.round(pa * 100)}%</b></div><div class="apos-l"><span>${nm(local)}</span><span>${nm(vis)}</span></div></section>` : '';
  return `<section><h3>Minuto a minuto ${leg.vivo ? `<span class="alive">${esc(leg.vivo)}</span>` : '<span class="chip">Final</span>'}</h3>${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Sin eventos registrados.</p>'}</section>${pos}`;
}
function ascPrevia(s, E, cr, nm, when) {
  if (!s) return '';
  const i = s.ida || {}, vu = s.vuelta || {};
  const enJuego = i.vivo ? 'ida' : vu.vivo ? 'vuelta' : null;
  const leg = (enJuego === 'ida' || (!enJuego && (i.ga == null || i.live && vu.ga == null && !vu.live))) ? { ...i, cual: 'ida', local: s.a, vis: s.b } : { ...vu, cual: 'vuelta', local: s.b, vis: s.a };
  const F = ASCX.forms || {};
  const fo = k => F[k] && F[k].verificado ? F[k].rows : null;
  const grp = k => { for (const g of ASC.grupos || []) { const ix = g.tabla.findIndex(r => r[0] === E[k]?.nombre); if (ix >= 0) return { g, ix, r: g.tabla[ix] }; } return null; };
  const rec = (rows, f) => { const x = rows.filter(f); const w = x.filter(r => r.gf > r.ga).length, d = x.filter(r => r.gf === r.ga).length; return `${w}-${d}-${x.length - w - d}`; };
  const avg = (a, b) => b ? (a / b).toFixed(1) : '—';
  const L = leg.local, V = leg.vis, gl = grp(L), gv = grp(V), fl = fo(L), fv = fo(V);
  const cmp = gl && gv ? [
    ['Fase regular', `${gl.ix + 1}.º ${esc(gl.g.nombre)}`, `${gv.ix + 1}.º ${esc(gv.g.nombre)}`], ['Puntos', gl.r[7], gv.r[7]],
    ['Récord (G-E-P)', `${gl.r[2]}-${gl.r[3]}-${gl.r[4]}`, `${gv.r[2]}-${gv.r[3]}-${gv.r[4]}`],
    ['Goles por partido', avg(gl.r[5], gl.r[1]), avg(gv.r[5], gv.r[1])], ['Recibe por partido', avg(gl.r[6], gl.r[1]), avg(gv.r[6], gv.r[1])],
    ...(fl && fv ? [[`${nm(L)} de local / ${nm(V)} de visita`, rec(fl, r => r.home), rec(fv, r => !r.home)]] : []),
  ] : [];
  const ab = k => esc((E[k]?.nombre || k).replace(/^(AD|FC|CS)\s+/, '').split(' ')[0]);
  const last5 = k => { const rows = fo(k); return `<div><h3>${nm(k)}</h3><ul class="plist">${rows ? rows.slice(-5).reverse().map(x => { const r = x.gf > x.ga ? 'W' : x.gf < x.ga ? 'L' : 'D';
    return `<li><span class="res ${r}">${({ W: 'G', D: 'E', L: 'P' })[r]}</span>${x.home ? 'vs' : 'en'} ${esc(x.opp)}<span class="x">${x.gf}–${x.ga} · J${x.r}</span></li>`; }).join('') : '<li><span class="x" style="margin:0">Sin datos verificados</span></li>'}</ul></div>`; };
  const X = (ASCX.series || {})[s.n];
  const idOf = k => (ASCX.ids || {})[k];
  const hist = (X && X.h2h) || [];
  const hn = t => t.id === idOf(s.a) ? nm(s.a) : t.id === idOf(s.b) ? nm(s.b) : esc(t.n);
  let wa = 0, wb = 0, dr = 0; for (const x of hist) { const ga = x.h.id === idOf(s.a) ? x.hs : x.as, gb = x.h.id === idOf(s.a) ? x.as : x.hs; ga > gb ? wa++ : gb > ga ? wb++ : dr++; }
  return `<div class="detail">
    <div class="dscore">
      <div class="dteam r"><span>${nm(L)}</span>${cr(L)}</div>
      <div>${leg.live ? `<div class="dnum">${leg.cual === 'ida' ? `${leg.ga}–${leg.gb}` : `${leg.gb}–${leg.ga}`}</div>` : `<div class="dnum" style="font-size:40px">${leg.fecha ? esc(fmtTime(leg.fecha)) : '—'}</div>`}</div>
      <div class="dteam">${cr(V)}<span>${nm(V)}</span></div>
    </div>
    <div class="dmeta">${leg.live ? (leg.vivo ? 'En vivo' : 'Final') : 'Previa'} · ${leg.fecha ? esc(fmtDay(leg.fecha)) : 'Fecha por confirmar'} · Serie ${s.n} · Cuartos de final (${leg.cual})${leg.estadio ? venueHtml(leg.estadio) : ''}${leg.tv ? ` · ${esc(leg.tv)}` : ''}</div>
    <div class="pv"><div class="pv-data" style="flex-basis:100%">
      ${ascLiveHtml(leg, leg.local, leg.vis, nm)}
      <section><h3>La serie</h3><ul class="plist">
        <li><b>Ida</b>&nbsp;· local ${nm(s.a)}<span class="x">${esc(when(i))}${i.ga != null ? ` · ${i.ga}–${i.gb}` : ''}</span></li>
        <li><b>Vuelta</b>&nbsp;· local ${nm(s.b)}<span class="x">${esc(when(vu))}${vu.ga != null ? ` · ${vu.gb}–${vu.ga}` : ''}</span></li>
      </ul></section>
      ${cmp.length ? `<section><h3>Cómo llegan</h3><table class="cmp"><tr><td>${ab(L)}</td><td></td><td>${ab(V)}</td></tr>${cmp.map(c => `<tr><td>${c[1]}</td><td>${c[0]}</td><td>${c[2]}</td></tr>`).join('')}</table></section>` : ''}
      <section><h3>Últimos 5 de la fase regular</h3><div class="two">${last5(L)}${last5(V)}</div></section>
      <section><h3>Historial entre ellos</h3>${hist.length ? `<p class="foot" style="margin:0 0 6px">Últimos ${hist.length}: ${nm(s.a)} ${wa} · empates ${dr} · ${nm(s.b)} ${wb}</p><ul class="plist">${hist.map(x => `<li><span class="x" style="margin:0;min-width:84px;text-align:left">${esc(new Date(x.d).toLocaleDateString('es-CR', { ...tz, day: 'numeric', month: 'short', year: 'numeric' }))}</span>${hn(x.h)} <b>${x.hs}–${x.as}</b> ${hn(x.a)}<span class="x">${esc(x.lg || '')}</span></li>`).join('')}</ul>` : '<ul class="plist"><li><span class="x" style="margin:0">No hay partidos previos registrados entre ellos</span></li></ul>'}</section>
    </div></div></div>`;
}
function renderSele(v) {
  if (!SE) {
    v.innerHTML = '<section class="panel"><p class="hint">Cargando la Sele…</p></section>';
    if (SE === null) { SE = false; fetch('/data/sele.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { matches: [] }).catch(() => ({ matches: [] })).then(j => { SE = j; if (S.view === 'sele') renderView(); }); }
    return;
  }
  const ES = { England: 'Inglaterra', Haiti: 'Haití', Iran: 'Irán', Jordan: 'Jordania', Panama: 'Panamá', Mexico: 'México', 'USA': 'Estados Unidos', 'United States': 'Estados Unidos', Canada: 'Canadá', Peru: 'Perú', Brazil: 'Brasil', Japan: 'Japón', 'South Korea': 'Corea del Sur', Scotland: 'Escocia', Wales: 'Gales', Morocco: 'Marruecos', Belgium: 'Bélgica', Spain: 'España', Germany: 'Alemania', France: 'Francia', Italy: 'Italia', 'Saudi Arabia': 'Arabia Saudita', 'Trinidad and Tobago': 'Trinidad y Tobago', 'Dominican Republic': 'República Dominicana', Suriname: 'Surinam', Guadeloupe: 'Guadalupe', Martinique: 'Martinica', 'St. Kitts and Nevis': 'San Cristóbal y Nieves' };
  const CR = SE.teamId, ms = (SE.matches || []).map(m => ({ ...m, h: { ...m.h, name: ES[m.h.name] || m.h.name }, a: { ...m.a, name: ES[m.a.name] || m.a.name } })), now = Date.now();
  SEms = ms;
  const done = ms.filter(m => m.hs != null), apiNext = ms.filter(m => m.hs == null && new Date(m.d).getTime() > now - 3 * 3600e3);
  // partidos anunciados que la API todavía no publica (se escriben a mano en data/sele.json)
  const nn = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const manual = (SE.proximos || []).map((x, i) => ({ id: -(i + 1), manual: true, d: x.fecha + 'T12:00:00-06:00', comp: x.torneo, sede: x.sede,
      h: { id: nn(x.local) === 'costa rica' ? CR : null, name: x.local, logo: null }, a: { id: nn(x.visita) === 'costa rica' ? CR : null, name: x.visita, logo: null } }))
    .filter(x => new Date(x.d).getTime() > now - 864e5 && !ms.some(m => Math.abs(new Date(m.d) - new Date(x.d)) < 3 * 864e5 && [m.h.name, m.a.name].some(n => nn(n) === nn(x.h.id === CR ? x.a.name : x.h.name))));
  for (const m of apiNext) if (!m.sede) { const x = (SE.proximos || []).find(x => Math.abs(new Date(x.fecha + 'T12:00:00-06:00') - new Date(m.d)) < 2 * 864e5); if (x) { m.sede = x.sede; if (x.hora === false) m.tbd = true; } }
  const next = [...apiNext, ...manual].sort((a, b) => new Date(a.d) - new Date(b.d));
  const logoOf = name => { for (const m of ms) for (const t of [m.h, m.a]) if (nn(t.name) === nn(name) && t.logo) return t.logo; return null; };
  for (const x of manual) for (const t of [x.h, x.a]) t.logo = logoOf(t.name);
  const all = [...ms, ...manual];
  const year = new Date().getFullYear();
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="crest ph" aria-hidden="true">${esc((t.name || '?').slice(0, 3).toUpperCase())}</span>`;
  const resOf = m => { const home = m.h.id === CR, gf = home ? m.hs : m.as, ga = home ? m.as : m.hs; return gf > ga ? 'W' : gf < ga ? 'L' : 'D'; };
  const compName = c => ({ 'Friendlies': 'Amistoso', 'Friendlies International': 'Amistoso', 'International Friendlies': 'Amistoso', 'CONCACAF Gold Cup': 'Copa Oro', 'CONCACAF Nations League': 'Liga de Naciones', 'World Cup - Qualification CONCACAF': 'Eliminatoria mundialista', 'FIFA World Cup': 'Mundial' })[c] || c || '';
  const card = m => { const p = m.hs != null, r = p ? resOf(m) : null, lv = seleLive(m.id), [lh, la] = lv ? (lv.score || '0 - 0').split(' - ') : [];
    const tag = lv ? (lv.finished ? '<b>Final</b>' : `<span class="lv">${/half time/i.test(lv.status) ? 'ENTRETIEMPO' : `EN VIVO ${lv.clock ?? ''}'`}</span>`) : null;
    return `<button type="button" class="cc" data-sele="${m.id}" aria-pressed="${SEsel === m.id}">
      <span class="meta"><span>${esc(fmtDay(m.d))}</span><span>${tag || (p ? `<b class="sr ${r}">${({ W: 'Ganó', D: 'Empató', L: 'Perdió' })[r]}</b>` : m.manual || m.tbd ? 'Hora por definir' : esc(fmtTime(m.d)))}</span></span>
      ${[[m.h, lv ? lh : m.hs], [m.a, lv ? la : m.as]].map(([t, g]) => `<span class="row${t.id === CR ? ' tico' : ''}${p && t.id !== CR && r !== 'L' ? ' lose' : ''}">${cr(t)}<span>${esc(t.name)}</span><span class="sc">${g ?? ''}</span></span>`).join('')}
      <span class="meta"><span>${esc(compName(m.comp))}${m.sede ? ' · ' + esc(m.sede) : ''}</span></span></button>`; };
  // números del año y goleadores (de los partidos con minuto a minuto)
  const yr = done.filter(m => new Date(m.d).getFullYear() === year);
  const tot = yr.reduce((a, m) => { const home = m.h.id === CR, gf = home ? m.hs : m.as, ga = home ? m.as : m.hs; a.pj++; a[resOf(m)]++; a.gf += gf; a.gc += ga; return a; }, { pj: 0, W: 0, D: 0, L: 0, gf: 0, gc: 0 });
  const gls = {};
  const title = n => /[A-ZÁÉÍÓÚÑ]/.test(n) ? n : n.replace(/(^|\s)\S/g, c => c.toUpperCase());
  for (const m of yr) for (const [, type, isHome, player] of (m.ev || [])) {
    if (!player || (type !== 'goal' && type !== 'pen')) continue; if ((isHome ? m.h.id : m.a.id) !== CR) continue;
    const parts = nn(player).replace(/\./g, '').split(/\s+/), k = parts[0][0] + ' ' + parts.slice(1).join(' ');
    const g = gls[k] ||= { name: title(player), n: 0 }; g.n++; if (player.length > g.name.length && !/\./.test(player)) g.name = title(player);
  }
  const topG = Object.values(gls).sort((a, b) => b.n - a.n).slice(0, 5).map(g => [g.name, g.n]);
  const sel = all.find(m => m.id === SEsel);
  const upd = SE.updated ? new Date(SE.updated).toLocaleDateString('es-CR', { ...tz, day: 'numeric', month: 'short', year: 'numeric' }) : '';
  v.innerHTML = `<div class="copa sele">
    <div class="chead"><h1><span class="flagcr" aria-hidden="true">🇨🇷</span> La Sele</h1><span>Selección de Costa Rica${upd ? ` · datos al ${esc(upd)}` : ''} · tocá un partido para ver la previa o el resumen</span></div>
    <div id="sdetail">${sel ? seleDetailHtml(sel, CR, compName) : ''}</div>
    <section class="panel"><h2 class="ch">Próximos partidos</h2>${next.length ? `<div class="cgrid">${next.map(card).join('')}</div>` : '<p class="hint">No hay partidos anunciados todavía.</p>'}</section>
    ${convHtml(SE.convocatoria)}
    <div class="cols">
      <div class="wide"><section class="panel"><h2 class="ch">Últimos partidos</h2>${done.length ? `<div class="cgrid">${done.slice(-6).reverse().map(card).join('')}</div>` : '<p class="hint">Sin partidos cargados.</p>'}</section></div>
      <div class="side">
        <section class="panel"><h2 class="ch">Cuerpo técnico</h2><ul class="plist staff">${(SE.staff || []).map(x => `<li><span class="x" style="margin:0 10px 0 0;min-width:120px">${esc(x.rol)}</span><b>${esc(x.nombre)}</b>${x.nota ? `<span class="x">${esc(x.nota)}</span>` : ''}</li>`).join('')}</ul></section>
        <section class="panel"><h2 class="ch">En ${year}</h2>${tot.pj ? `<div class="snums">${[['PJ', tot.pj], ['G', tot.W], ['E', tot.D], ['P', tot.L], ['GF', tot.gf], ['GC', tot.gc]].map(([k, x]) => `<span><b>${x}</b><i>${k}</i></span>`).join('')}</div>
          ${topG.length ? `<p class="lead" style="margin:14px 0 6px">Goleadores</p><ol class="list">${topG.map(([n, g]) => `<li><span class="nm"><b>${esc(n)}</b></span><span class="big" style="font-size:22px">${g}</span></li>`).join('')}</ol>` : ''}` : '<p class="hint">Todavía no ha jugado este año.</p>'}</section>
      </div>
    </div>
    </div>`;
  v.querySelectorAll('[data-sele]').forEach(b => b.onclick = () => {
    SEsel = SEsel === +b.dataset.sele ? null : +b.dataset.sele; renderView();
    const el = document.getElementById('sdetail');
    if (SEsel && el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (document.querySelector('.top')?.offsetHeight || 0) - 12, behavior: 'smooth' });
  });
}
const seleLive = id => LIVE.find(x => x.id === id && x.comp === 'La Sele' && x.started);
/* Convocatoria: lista a mano en data/sele.json; a los de la Primera se les suman sus goles del torneo y asistencias (UNAFUT) */
function convHtml(C) {
  if (!C || !C.grupos) return '';
  const nn = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tid = club => Object.keys(T).find(k => nn(T[k].name) === nn(club));
  const goles = (nombre, t) => { const w = nn(nombre).split(/\s+/), sur = w[w.length - 1], ini = w[0][0]; let n = 0;
    for (const m of M) for (const e of (m.ev || [])) if (['goal', 'pen'].includes(e[1]) && e[3] && (e[2] ? m.h : m.a) === +t) { const x = nn(e[3]).replace(/\./g, '').split(/\s+/); if (x[x.length - 1] === sur && x[0][0] === ini) n++; }
    return n; };
  const asis = nombre => ((ASIS && ASIS.lista) || []).find(x => nn(x.jugador) === nn(nombre))?.a;
  const all = C.grupos.flatMap(g => g.jugadores), local = all.filter(j => tid(j.club)), clubs = {};
  for (const j of local) clubs[j.club] = (clubs[j.club] || 0) + 1;
  const top = Object.entries(clubs).sort((a, b) => b[1] - a[1])[0];
  return `<section class="panel conv"><h2 class="ch">${esc(C.titulo || 'Convocatoria')}</h2>
    <p class="lead">${all.length} convocados · ${local.length} de la liga local · ${all.length - local.length} legionarios${top ? ` · ${esc(top[0])} aporta ${top[1]}` : ''}</p>
    <div class="cvgrid">${C.grupos.map(g => `<div><h3>${esc(g.pos)}</h3><ul class="plist">${g.jugadores.map(j => { const t = tid(j.club), gl = t ? goles(j.nombre, t) : 0, as = t ? asis(j.nombre) : null;
      const nums = [gl ? `${gl} ${gl === 1 ? 'gol' : 'goles'}` : '', as ? `${as} asist.` : ''].filter(Boolean).join(' · ');
      return `<li>${t ? crest(t) : '<span class="crest ph" aria-hidden="true">✈</span>'}<span class="cvn"><b>${esc(j.nombre)}</b><span class="x">${esc(j.club)}${nums ? ' · ' + nums : ''}</span></span></li>`; }).join('')}</ul></div>`).join('')}</div>
    <p class="hint">Goles y asistencias en el Apertura 2026 de los convocados de la liga local.</p></section>`;
}
function seleDetailHtml(m, CR, compName) {
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="">` : `<span class="crest ph" aria-hidden="true">${esc((t.name || '?').slice(0, 3).toUpperCase())}</span>`;
  const head = mid => `<div class="dscore"><div class="dteam r"><span>${esc(m.h.name)}</span>${cr(m.h)}</div><div>${mid}</div><div class="dteam">${cr(m.a)}<span>${esc(m.a.name)}</span></div></div>`;
  const meta = `${esc(compName(m.comp))} · ${esc(fmtDay(m.d))}`;
  const lv = seleLive(m.id);
  if (lv) {
    const [h, a] = (lv.score || '0 - 0').split(' - ');
    const ev = reconcile(sortEvents({ events: (lv.events || []).map(e => e.slice()) }).events || [], +h, +a, !lv.finished);
    const st = lv.stats || [], hi = st[0] && st[0].t === m.h.id ? 0 : 1, ph = st[hi]?.s?.Possession, pa = st[1 - hi]?.s?.Possession;
    const vivo = lv.finished ? 'Final' : /half time/i.test(lv.status) ? 'Entretiempo' : `En vivo · ${lv.clock ?? ''}'`;
    return `<div class="detail cd">${head(`<div class="dnum">${h} – ${a}</div>`)}<div class="dmeta">${esc(vivo)} · ${meta}${m.sede ? ' · ' + esc(m.sede) : ''}</div>
      <div class="dcols"><div><h3>Minuto a minuto</h3>${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Todavía sin eventos.</p>'}</div>
      ${ph != null && pa != null ? `<div><h3>Posesión</h3><div class="apos"><b>${Math.round(ph * 100)}%</b><span class="bar"><i style="width:${ph * 100}%"></i></span><b>${Math.round(pa * 100)}%</b></div><div class="apos-l"><span>${esc(m.h.name)}</span><span>${esc(m.a.name)}</span></div></div>` : ''}</div></div>`;
  }
  if (m.manual) return `<div class="detail cd">${head('<div class="dnum" style="font-size:20px;white-space:nowrap">Por definir</div>')}<div class="dmeta">Previa · ${meta}${m.sede ? ' · ' + esc(m.sede) : ''}</div></div>`;
  if (m.hs != null) {
    const ev = sortEvents({ events: m.ev || [] }).events;
    const sts = m.stats && m.stats.length === 2 ? m.stats : null, hi = sts && sts[0].t === m.h.id ? 0 : 1;
    const bars = sts ? STATS.map(([k, lab, f = v => v]) => { const h = sts[hi].s[k], a = sts[1 - hi].s[k]; if (h === undefined || h === null) return ''; const t = (h + a) || 1;
      return `<div class="sbar"><div class="lab"><span>${f(h)}</span><span>${lab}</span><span>${f(a)}</span></div><div class="bars"><i style="flex:${h / t || .001};background:var(--accent)"></i><i style="flex:${a / t || .001};background:var(--draw)"></i></div></div>`; }).join('') : '';
    return `<div class="detail cd">${head(`<div class="dnum">${m.hs} – ${m.as}</div>`)}<div class="dmeta">Final · ${meta}</div>
      <div class="dcols"><div><h3>Minuto a minuto</h3>${ev.length ? `<ol class="tl">${ev.map(e => `<li><span class="h">${e[2] ? evHtml(e) : ''}</span><span class="min">${esc(e[0])}'</span><span>${e[2] ? '' : evHtml(e)}</span></li>`).join('')}</ol>` : '<p class="hint">Sin minuto a minuto para este partido.</p>'}</div>
      ${bars ? `<div><h3>Estadísticas</h3>${bars}</div>` : ''}</div></div>`;
  }
  const P = PREVIA[m.id];
  if (P === undefined) { PREVIA[m.id] = null; fetch('/api/previa?id=' + m.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { PREVIA[m.id] = j || {}; if (S.view === 'sele' && SEsel === m.id) renderView(); }); }
  const lu = P && P.lineups;
  const pr = P && P.predictions?.prematch?.length ? P.predictions.prematch[P.predictions.prematch.length - 1].probabilities : null;
  const prob = pr ? (() => { const h = parseFloat(pr.home), d = parseFloat(pr.draw), a = parseFloat(pr.away);
    return `<div class="pred"><div class="bar"><i style="flex:${h};background:var(--accent)"></i><i style="flex:${d};background:var(--draw)"></i><i style="flex:${a};background:var(--away)"></i></div>
      <div class="lab"><span>${esc(m.h.name)} <b>${Math.round(h)}%</b></span><span>Empate <b>${Math.round(d)}%</b></span><span>${esc(m.a.name)} <b>${Math.round(a)}%</b></span></div></div>`; })() : '';
  const rival = m.h.id === CR ? m.a : m.h;
  const ms = SEms;
  const h2h = ms.filter(x => x.hs != null && (x.h.id === rival.id || x.a.id === rival.id));
  const last5 = ms.filter(x => x.hs != null).slice(-5).reverse();
  const line = x => { const home = x.h.id === CR, gf = home ? x.hs : x.as, ga = home ? x.as : x.hs, r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return `<li><span class="res ${r}">${({ W: 'G', D: 'E', L: 'P' })[r]}</span>${home ? 'vs' : 'en'} ${esc(home ? x.a.name : x.h.name)}<span class="x">${gf}–${ga} · ${esc(fmtDay(x.d))}</span></li>`; };
  return `<div class="detail cd">${head(m.tbd ? '<div class="dnum" style="font-size:20px;white-space:nowrap">Hora por definir</div>' : `<div class="dnum" style="font-size:40px">${esc(fmtTime(m.d))}</div>`)}
    <div class="dmeta">Previa · ${meta}${P && P.venue?.name ? ' · ' + esc(P.venue.name) : ''}</div>${prob}
    <div class="pv">${lu ? `<section class="pv-lu" style="${kitVars(m.h.name, m.a.name)}"><h3>Alineaciones</h3><p class="lead"><span class="chip ok">Alineación oficial</span></p>
      <div class="fbar"><span><i class="dot h"></i> ${esc(m.h.name)}</span><span class="f">${esc(lu.home.formation || '')}</span></div>${pitchHtml(lu.home, lu.away)}
      <div class="fbar"><span><i class="dot a"></i> ${esc(m.a.name)}</span><span class="f">${esc(lu.away.formation || '')}</span></div></section>`
      : `<section class="pv-lu"><h3>Alineaciones</h3><p class="hint">La alineación oficial aparece aquí cerca del pitazo.</p></section>`}
    <div class="pv-data">
      <section><h3>Costa Rica · últimos 5</h3><ul class="plist">${last5.map(line).join('') || '<li><span class="x" style="margin:0">Sin partidos cargados</span></li>'}</ul></section>
      <section><h3>Contra ${esc(rival.name)}, últimos dos años</h3><ul class="plist">${h2h.map(line).join('') || '<li><span class="x" style="margin:0">No se enfrentaron en este periodo</span></li>'}</ul></section>
    </div></div></div>`;
}
function go(view) { S.view = view; try { history.replaceState(null, '', '#' + view); } catch(e){} renderView(); try { renderLive(); renderLdet(); } catch (e) {} window.scrollTo({ top: 0 }); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.v));

/* Si el minuto a minuto tiene más goles que el marcador (gol anulado que la API no ha borrado),
   el marcador manda y los goles sobrantes, de atrás para adelante, se marcan como anulados. */
/* Doble amarilla: la API manda la roja y la segunda amarilla por separado (a veces la roja primero).
   Se muestra una sola línea "Doble amarilla · expulsado" en el minuto de la segunda amarilla. */
function dobleAm(ev) {
  const k = e => e[2] + '|' + e[3];
  const ycs = {}; ev.forEach((e, i) => { if (e[1] === 'yc' && e[3]) (ycs[k(e)] ||= []).push(i); });
  const drop = new Set();
  for (const idx of Object.values(ycs)) {
    if (idx.length < 2) continue;
    idx.sort((i, j) => minN(ev[i][0]) - minN(ev[j][0]));
    const second = ev[idx[1]]; second[1] = 'dra';
    ev.forEach((e, i) => { if (e[1] === 'rc' && k(e) === k(second) && Math.abs(minN(e[0]) - minN(second[0])) <= 2) drop.add(i); });
  }
  return ev.filter((e, i) => !drop.has(i));
}
function reconcile(events, hs, as, enVivo) {
  const ev = dobleAm(events.map(e => e.slice()));
  // en vivo la API a veces manda el gol antes de actualizar el marcador: no marcarlo como anulado
  if (enVivo) return ev;
  const isGoal = e => e[1] === 'goal' || e[1] === 'pen' || e[1] === 'og';
  for (const [side, max] of [[1, hs], [0, as]]) {
    let count = ev.filter(e => isGoal(e) && e[2] === side).length;
    for (let i = ev.length - 1; i >= 0 && count > max; i--) {
      if (isGoal(ev[i]) && ev[i][2] === side) { ev[i][1] = 'var'; ev[i].fixed = true; count--; }
    }
  }
  // si la API después agrega su propio aviso de "gol anulado", no repetirlo
  return ev.filter(e => !(e[1] === 'var' && !e.fixed && ev.some(x => x.fixed && x[2] === e[2])));
}
/* El minuto a minuto sigue exactamente lo que diga la API, en orden de minuto (45+2 después de 45). */
function sortEvents(L) {
  const order = t => { const [a, b] = String(t).split('+'); return (+a || 0) + (+b || 0) / 100; };
  return { ...L, events: (L.events || []).slice().sort((a, b) => order(a[0]) - order(b[0])) };
}
const COMP = { 'Concacaf Central American Cup': 'Copa Centroamericana', 'CONCACAF Champions Cup': 'Copa de Campeones Concacaf' };
function renderLive() {
  const el = document.getElementById('live');
  // los playoffs de Ascenso salen en la franja solo en Inicio (y en su propia pestaña)
  const okComp = x => x.comp === 'La Sele' ? ['inicio', 'sele'].includes(S.view) : x.comp !== 'Liga de Ascenso' || S.view === 'inicio';
  const now = LIVE.filter(x => x.started && !x.finished && okComp(x));
  const soon = LIVE.filter(x => !x.started && okComp(x) && x.comp !== 'Liga de Ascenso');
  if (!now.length && !soon.length) { el.hidden = true; syncBoard(); return; }
  el.hidden = false; syncBoard();
  const cr = t => t.logo || t.id ? `<img class="crest" src="${esc(t.logo || `https://highlightly.net/soccer/images/teams/${t.id}.png`)}" alt="">` : `<span class="crest ph" aria-hidden="true">${esc(t.ab || '')}</span>`;
  if (LIVE.some(x => x.comp === 'Liga de Ascenso') && ASC === null) loadAsc(() => { renderLive(); renderLdet(); });
  const fixT = t => { const o = ascTeam(t.id); return o ? { ...t, name: o.nombre, logo: o.escudo } : t; };
  const item = L0 => {
    const L = L0.comp === 'Liga de Ascenso' ? { ...L0, h: fixT(L0.h), a: fixT(L0.a) } : L0;
    const [hs, as] = (L.score || '0 - 0').split(' - ');
    const evs = reconcile(L.events, +hs, +as, true);
    const e = evs[evs.length - 1];
    const last = e ? `${esc(e[0])}' · ${e[1] === 'sub' ? `Entra <b>${esc(e[4])}</b> <span class="note">sale ${esc(e[3])}</span>` : `<b>${esc(e[3] || '')}</b> <span class="note">${EVL[e[1]] || esc(e[1])}</span>`}` : 'Sin eventos todavía';
    const clock = /half time/i.test(L.status) ? 'ENTRETIEMPO' : `EN VIVO ${L.clock ?? ''}'`;
    const inLeague = M.some(x => x.id === L.id) || (D.intl || []).some(x => x.id === L.id) || L.comp === 'Liga de Ascenso' || L.comp === 'La Sele';
    return `<${inLeague ? `button type="button" class="litem" data-live="${L.id}"` : 'div class="litem"'}>${L.started ? `<span class="tag"><i></i>${clock}</span>` : `<span class="tag soon">${esc(fmtTime(L.d))}</span>`}
      <span class="sc">${cr(L.h)}<span>${esc(L.h.name)}</span><b>${L.started ? `${hs} – ${as}` : 'vs'}</b><span>${esc(L.a.name)}</span>${cr(L.a)}</span>
      <span class="comp">${esc(COMP[L.comp] || L.comp)}</span>${L.started ? `<span class="last">Último: ${last}</span>` : ''}${inLeague ? '<span class="go">Ver partido →</span>' : ''}</${inLeague ? 'button' : 'div'}>`;
  };
  el.innerHTML = [...now, ...soon].map(item).join('');
  el.querySelectorAll('[data-live]').forEach(b => b.onclick = () => {
    const m = M.find(x => x.id === +b.dataset.live);
    const L = LIVE.find(x => x.id === +b.dataset.live);
    if (L && L.comp === 'La Sele') { SEsel = L.id; go('sele'); return; }
    if (L && L.comp === 'Liga de Ascenso') { S.ldet = S.ldet === L.id ? null : L.id; renderLdet(); if (S.ldet) document.getElementById('ldetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (!m) { S.cid = +b.dataset.live; go('copa'); setTimeout(() => document.getElementById('cdetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); return; }
    S.j = m.r; S.sel = m.id; S.moved = true; renderBoard();
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
async function pollLive() {
  if (document.hidden) return;
  try {
    const r = await fetch('/api/live', { cache: 'no-store' });
    const j = await r.json();
    LIVE = (j.live || []).map(sortEvents);
    const lvM = LIVE.map(x => M.find(m => m.id === x.id && x.started && !x.finished)).find(Boolean);
    if (lvM && !S.moved) S.j = lvM.r;
  } catch (e) { /* sin conexión: se mantiene lo último */ }
  renderLive(); renderBoard(); renderLdet();
  // la tabla y los goleadores también usan los resultados recién terminados
  if (S.view === 'inicio' || S.view === 'tabla' || S.view === 'copa' || (S.view === 'ascenso' && LIVE.some(x => x.comp === 'Liga de Ascenso')) || (S.view === 'sele' && LIVE.some(x => x.comp === 'La Sele'))) renderView();
}
/* Botón ✕ en cualquier detalle de partido (liga, Copa, Sele) para cerrarlo sin tener que buscar el partido otra vez */
function addCloseButtons() {
  document.querySelectorAll('.detail').forEach(d => {
    if (d.querySelector(':scope > .dx')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dx'; b.setAttribute('aria-label', 'Cerrar'); b.textContent = '✕';
    b.onclick = () => {
      if (d.closest('#cdetail')) { S.cid = null; renderView(); }
      else if (d.closest('#sdetail')) { SEsel = null; renderView(); }
      else if (d.closest('#adetail')) { S.asel = null; renderView(); }
      else if (d.closest('#ldetail')) { S.ldet = null; renderLdet(); }
      else { S.sel = null; renderBoard(); }
    };
    d.prepend(b);
  });
}
new MutationObserver(addCloseButtons).observe(document.body, { childList: true, subtree: true });
renderLive(); renderBoard(); renderView();
pollLive(); setInterval(pollLive, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
}
let LIVE = [];
/* Alineaciones oficiales que se escriben a mano desde las redes de los clubes (cuando la API no las trae) */
let MANUAL = {}, ESTADIOS = {}, TARJETAS = {}, EVENTOS = {}, XSTATS = {}, ASIS = {};
fetch('/data/estadios.json').then(r => r.ok ? r.json() : {}).then(j => { ESTADIOS = j || {}; }).catch(() => {});
const loadManual = () => fetch('/data/alineaciones.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { MANUAL = j || {}; });
setInterval(() => loadManual(), 60000);
const getJ = (u, d = {}) => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : d).catch(() => d);
// todo se pide a la vez (antes iba uno detrás de otro y la página tardaba en aparecer)
Promise.all([loadManual(), getJ('/data/tarjetas.json'), getJ('/data/eventos.json'), getJ('/data/estadisticas.json'), getJ('/data/asistencias.json'), getJ('/data/season.json', null)])
  .then(([, tj, ev, st, as, season]) => { TARJETAS = tj || {}; EVENTOS = ev || {}; XSTATS = st || {}; ASIS = as || {}; if (!season) throw new Error('season'); return season; }).then(start).catch(() => {
  document.getElementById('view').innerHTML = '<p class="hint">No se pudieron cargar los datos. Recargá la página.</p>';
});
