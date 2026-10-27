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
const M = D.matches.slice().sort((a,b) => new Date(a.d) - new Date(b.d));
const rounds = [...new Set(M.map(m => m.r))].sort((a,b) => a-b);
const lastPlayed = Math.max(...M.filter(played).map(m => m.r));

const soonRound = M.filter(m => !played(m) && new Date(m.d) - Date.now() < 3 * 864e5).map(m => m.r);
const currentRound = soonRound.length && M.filter(m => m.r === lastPlayed).every(played) ? Math.min(...soonRound) : lastPlayed;
let S = { view:'inicio', j:currentRound, sel:null, tmode:'total', moved:false };
try { const v = location.hash.slice(1); if (['inicio','tabla','goleadores','disciplina','copa','legionarios'].includes(v)) S.view = v; } catch(e){}

document.getElementById('src').textContent = `Actualizado ${new Date(D.updated).toLocaleString('es-CR',{ ...tz, day:'numeric', month:'short', hour:'numeric', minute:'2-digit' })}`;

/* ---------- aggregates from events ---------- */
const scorers = {}, yellows = {}, reds = [], teamCards = {};
for (const m of M.filter(played)) {
  for (const [time, type, isHome, player, subIn] of (m.ev || [])) {
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
  for (const [time, type, isHome, player] of (m.ev || [])) {
    if (!player || (type !== 'yc' && type !== 'rc')) continue;
    const tid = isHome ? m.h : m.a, key = player + '|' + tid;
    if (type === 'yc') {
      cycle[key] = (cycle[key] || 0) + 1;
      if (cycle[key] === YELLOW_LIMIT) { suspensions.push({ name: player, t: tid, after: m, why: '5 amarillas' }); cycle[key] = 0; }
    } else {
      suspensions.push({ name: player, t: tid, after: m, why: 'Roja' });
    }
  }
}
for (const y of Object.values(yellows)) y.cycle = cycle[y.name + '|' + y.t] || 0;
/* suspendidos para el próximo partido de su equipo: la sanción salió de su último partido jugado */
const suspendedNext = suspensions.filter(s => lastMatchOf[s.t] && lastMatchOf[s.t].id === s.after.id)
  .map(s => ({ ...s, next: nextMatchOf(s.t) }));
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
    const lv = LIVE.find(x => x.id === m.id && x.finished && x.score);
    return lv ? { ...m, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1] } : null;
  }).filter(Boolean);
  for (const m of results) {
    for (const [tid, gf, ga, isHome] of [[m.h, m.hs, m.as, true], [m.a, m.as, m.hs, false]]) {
      if (mode === 'home' && !isHome) continue;
      if (mode === 'away' && isHome) continue;
      const r = acc[tid] ||= { t: tid, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
      r.pj++; r.gf += gf; r.gc += ga;
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
  return `${fmtDay(m.d)} · ${fmtTime(m.d)}`;
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
    const m = lv ? { ...m0, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: lv.events, ...(lv.finished ? {} : { liveClock: lv.clock }) } : m0;
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
  const ms = M.filter(x => played(x) && (x.h === tid || x.a === tid) && D.detail[String(x.id)]?.lineups).reverse();
  for (const x of ms) {
    const L = D.detail[String(x.id)].lineups[x.h === tid ? 'h' : 'a'];
    if (L && L.xi && L.xi.length) return { formation: L.f, rows: rowsFrom(L.f, L.xi), from: x };
  }
  return null;
}
const surname = n => { const parts = String(n || '').split(' '); return /^[A-ZÁÉÍÓÚÑ]\.$/.test(parts[0]) ? parts.slice(1).join(' ') : String(n || ''); };
function pitchHtml(home, away) {
  const place = (side, rows, top) => rows.map((row, i) => {
    const t = rows.length === 1 ? 0.5 : i / (rows.length - 1), y = top ? 7 + t * 36 : 93 - t * 36;
    return row.map((p, j) => `<div class="pl ${side}" style="left:${(j + 1) / (row.length + 1) * 100}%;top:${y}%;width:${row.length >= 5 ? 18 : 22}%"><b>${esc(p.n ?? '')}</b><span>${esc(surname(p.name))}</span></div>`).join('');
  }).join('');
  return `<div class="pitch" role="img" aria-label="Alineaciones en la cancha">
    <div class="ln out"></div><div class="ln mid"></div><div class="ln circle"></div><div class="ln box1"></div><div class="ln box2"></div>
    ${home ? place('h', home.rows, true) : '<p class="pempty top">Sin alineación todavía</p>'}
    ${away ? place('a', away.rows, false) : '<p class="pempty bot">Sin alineación todavía</p>'}</div>`;
}
function renderPrevia(m, box) {
  const P = PREVIA[m.id];
  if (P === undefined) {
    PREVIA[m.id] = null;
    fetch('/api/previa?id=' + m.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { PREVIA[m.id] = j || {}; if (S.sel === m.id) renderDetail(); });
  }
  const off_ = P && P.lineups;
  const side = (tid, key) => off_ ? { formation: P.lineups[key].formation, rows: P.lineups[key].rows } : lastLineup(tid);
  const H = side(m.h, 'home'), A = side(m.a, 'away');
  const lineNote = off_ ? '<span class="chip ok">Alineación oficial</span>'
    : `<span class="chip">Probable</span> la última que usó cada equipo. La oficial sale entre 30 y 60 min antes del pitazo.`;

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
    <div class="dmeta">Previa · ${esc(fmtDay(m.d))} · Jornada ${m.r}${P && P.venue?.name ? ' · ' + esc(P.venue.name) : ''}</div>
    ${prob}
    <div class="pv">
      <section class="pv-lu"><h3>Alineaciones</h3><p class="lead">${lineNote}</p>
        <div class="fbar"><span><i class="dot h"></i> ${esc(T[m.h].name)}</span><span class="f">${esc(H?.formation || '')}</span></div>
        ${pitchHtml(H, A)}
        <div class="fbar"><span><i class="dot a"></i> ${esc(T[m.a].name)}</span><span class="f">${esc(A?.formation || '')}</span></div>
        ${!off_ && (H?.from || A?.from) ? `<p class="foot">Probable según su último partido con alineación registrada.</p>` : ''}
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

const EVL = { goal:'Gol', pen:'Gol de penal', og:'Autogol', yc:'Amarilla', rc:'Roja', sub:'Cambio', mp:'Penal fallado', var:'Gol anulado' };
const ICO = { goal:'goal', pen:'goal', og:'goal', yc:'yc', rc:'rc', mp:'miss', var:'miss' };
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
  const m = lv ? { ...base, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: reconcile(lv.events, +lv.score.split(' - ')[0], +lv.score.split(' - ')[1]), liveClock: lv.finished ? undefined : lv.clock } : base;
  if (!m) { box.innerHTML = `<p class="hint" style="background:transparent;color:var(--board-muted);padding:0;margin:0">Tocá un partido: los jugados muestran el minuto a minuto; los que vienen, la previa con alineaciones.</p>`; return; }
  if (!played(m) && !lv) { renderPrevia(m, box); return; }
  const ev = (m.ev || []).slice().sort((a,b) => parseInt(a[0]) - parseInt(b[0]) || (a[0].includes('+') - b[0].includes('+')));
  const det = lv && lv.stats && lv.stats.length === 2 ? { stats: lv.stats.map(t => t.s), statsTeams: lv.stats.map(t => t.t), lineups: null } : D.detail[String(m.id)];
  let extra = '';
  if (det) {
    const hi = det.statsTeams[0] === m.h ? 0 : 1, ai = 1 - hi;
    const bars = STATS.map(([k, lab, f = v => v]) => {
      const h = det.stats[hi][k], a = det.stats[ai][k]; if (h === undefined) return '';
      const tot = (h + a) || 1;
      return `<div class="sbar"><div class="lab"><span>${f(h)}</span><span>${lab}</span><span>${f(a)}</span></div>
        <div class="bars"><i style="flex:${h/tot || .001};background:var(--accent)"></i><i style="flex:${a/tot || .001};background:var(--draw)"></i></div></div>`;
    }).join('');
    const xi = side => `<ol>${side.xi.map(p => `<li><b>${p.n ?? ''}</b><span>${esc(p.name)}</span></li>`).join('')}</ol>`;
    extra = `<div class="dcols"><div><h3>Estadísticas</h3>${bars}</div>
      ${det.lineups ? `<div><h3>Alineaciones</h3><div class="lu"><div><p class="lead">${esc(T[m.h].name)} · ${esc(det.lineups.h.f)}</p>${xi(det.lineups.h)}</div><div><p class="lead">${esc(T[m.a].name)} · ${esc(det.lineups.a.f)}</p>${xi(det.lineups.a)}</div></div></div>` : ''}</div>`;
  } else if (!lv) {
    extra = `<p class="hint" style="margin-top:14px">Las estadísticas y alineaciones de este partido se completan en las próximas actualizaciones.</p>`;
  }
  box.innerHTML = `<div class="detail">
    <div class="dscore">
      <div class="dteam r"><span>${esc(T[m.h].name)}</span>${crest(m.h)}</div>
      <div><div class="dnum">${m.hs} – ${m.as}</div></div>
      <div class="dteam">${crest(m.a)}<span>${esc(T[m.a].name)}</span></div>
    </div>
    <div class="dmeta">${esc(statusLine(m))} · ${esc(fmtDay(m.d))}, ${esc(fmtTime(m.d))} · Jornada ${m.r}</div>
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
      <td class="l"><span class="tn">${crest(r.t)}${esc(T[r.t].name)}</span></td>
      <td>${r.pj}</td>${compact ? '' : `<td>${r.g}</td><td>${r.e}</td><td>${r.p}</td><td>${r.gf}</td><td>${r.gc}</td>`}
      <td>${dg > 0 ? '+' + dg : dg}</td><td class="pts">${r.pts}</td>${compact ? '' : `<td class="l">${formHtml(formOf(r.t, mode))}</td>`}</tr>`; }).join('')}</tbody></table></div>`;
}
function scorersHtml(n) {
  return `<ol class="list">${topScorers.slice(0, n).map((s,i) => `<li><span class="pos">${i+1}</span>${crest(s.t)}
    <span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)} · gol en ${s.matches.size} partido${s.matches.size === 1 ? '' : 's'}${s.pen ? ` · ${s.pen} de penal` : ''}</span></span><span class="big">${s.g}</span></li>`).join('')}</ol>`;
}
const cardRow = n => `<span class="cards" aria-label="${n} amarillas">${Array.from({length:n}, () => '<i class="ico yc"></i>').join('')}</span>`;
function yellowsHtml(n) {
  return `<ol class="list">${topYellow.slice(0, n).map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)} · última en J${y.last}${y.n >= YELLOW_LIMIT ? ' · ya cumplió suspensión' : ''}</span></span>${y.cycle === YELLOW_LIMIT - 1 ? '<span class="chip cap4">En capilla</span>' : ''}${cardRow(y.n)}<span class="big" style="font-size:22px;min-width:22px;text-align:right">${y.n}</span></li>`).join('')}</ol>`;
}

// El bloque de la jornada solo va en Inicio; en las otras pestañas queda solo la franja en vivo (si hay)
function syncBoard() {
  const home = S.view === 'inicio';
  document.querySelectorAll('[data-home]').forEach(el => { el.hidden = !home; });
  document.querySelector('.board').hidden = !home && document.getElementById('live').hidden;
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
        <section class="panel"><div class="ph2"><h2>Goleadores</h2><button class="more" data-go="goleadores">Ver todos →</button></div>${scorersHtml(5)}</section>
        <section class="panel"><div class="ph2"><h2>Disciplina</h2><button class="more" data-go="disciplina">Ver todo →</button></div>
          <p class="lead">Suspendidos para su próximo partido</p>
          ${suspendedNext.length ? `<ol class="list">${suspendedNext.map(s => `<li>${crest(s.t)}<span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)}</span></span><span class="chip sus">${esc(s.why)}</span></li>`).join('')}</ol>` : '<p class="hint">Nadie.</p>'}
          <p class="lead" style="margin-top:12px">En capilla (4 amarillas)</p>
          ${onFour.length ? `<ol class="list">${onFour.map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)}</span></span><span class="chip cap4">4</span></li>`).join('')}</ol>` : '<p class="hint">Nadie.</p>'}
        </section>
      </div></div>`;
  } else if (S.view === 'tabla') {
    v.innerHTML = `<section class="panel"><div class="ph2"><h2>Tabla de posiciones</h2>${seg}</div>${tableHtml(S.tmode)}
      <p class="foot">Local y Visita cuentan solo los partidos en esa condición. Últimos 5: G ganó, E empató, P perdió.</p></section>`;
  } else if (S.view === 'goleadores') {
    v.innerHTML = `<section class="panel"><div class="ph2"><h2>Goleadores · Apertura 2026</h2></div>${scorersHtml(30)}
      <p class="foot">Calculado a partir del minuto a minuto de los ${M.filter(played).length} partidos jugados. Los autogoles no cuentan para el jugador. La API no trae asistencias para esta liga.</p></section>`;
  } else if (S.view === 'legionarios') {
    renderLegio(v);
  } else if (S.view === 'copa') {
    v.innerHTML = copaHtml();
    v.querySelectorAll('[data-intl]').forEach(b => b.onclick = () => {
      S.cid = S.cid === +b.dataset.intl ? null : +b.dataset.intl; renderView();
      if (S.cid) document.getElementById('cdetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    const fair = Object.entries(teamCards).map(([t,c]) => ({ t:+t, ...c })).sort((a,b) => (b.y + b.r*3) - (a.y + a.r*3));
    v.innerHTML = `<div class="cols">
      <div class="wide">
        <section class="panel"><div class="ph2"><h2>Suspendidos para su próximo partido</h2></div>
          <p class="lead">5 amarillas en el torneo dan un partido de suspensión y el conteo vuelve a cero. La roja da al menos un partido; el tribunal puede dar más.</p>
          ${suspendedNext.length ? `<ol class="list">${suspendedNext.map(s => `<li><span class="chip sus">${esc(s.why)}</span>${crest(s.t)}<span class="nm"><b>${esc(s.name)}</b><span>${esc(T[s.t].name)} · se pierde ${s.next ? `J${s.next.r} vs ${esc(T[s.next.h === s.t ? s.next.a : s.next.h].name)}` : 'el próximo partido'}</span></span></li>`).join('')}</ol>` : '<p class="hint">Nadie suspendido para la próxima jornada.</p>'}
        </section>
        <section class="panel"><div class="ph2"><h2>En capilla</h2></div>
          <p class="lead">Con 4 amarillas en su conteo actual: una más y se pierden un partido.</p>
          ${onFour.length ? `<ol class="list">${onFour.map(y => `<li>${crest(y.t)}<span class="nm"><b>${esc(y.name)}</b><span>${esc(T[y.t].name)}</span></span>${cardRow(4)}</li>`).join('')}</ol>` : '<p class="hint">Nadie con 4 amarillas.</p>'}
        </section>
        <section class="panel"><div class="ph2"><h2>Amarillas en el torneo</h2></div>
          <p class="lead">Jugadores con 3 o más.</p>
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
    if (/group/i.test(r)) return `<section class="panel"><h2 class="ch">${esc(ROUND_ES[r] || r)}</h2><p class="lead">Partidos de los equipos ticos.</p><div class="cgrid">${ms.map(card).join('')}</div></section>`;
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
  return `<div class="copa"><div class="chead"><h1>Copa Centroamericana</h1><span>Concacaf ${esc(String(D.league?.season || ''))} · los equipos ticos · tocá un partido para ver el en vivo o la previa</span></div>
    <div id="cdetail">${sel ? intlDetailHtml(sel) : ''}</div>${order.map(section).join('')}
    <p class="foot">En vivo con la misma franja de arriba. Los ticos van resaltados.</p></div>`;
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
    const ev = reconcile(lv.events, hs, as);
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
    return `<div class="detail cd">${head(`<div class="dnum">${m.hs} – ${m.as}</div>`)}<div class="dmeta">Final · ${esc(roundName)} · ${esc(fmtDay(m.d))}</div>
      <p class="hint" style="margin-top:12px">En la Copa, el minuto a minuto se muestra durante el partido.</p></div>`;
  }
  // previa
  const P = PREVIA[m.id];
  if (P === undefined) { PREVIA[m.id] = null; fetch('/api/previa?id=' + m.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => { PREVIA[m.id] = j || {}; if (S.view === 'copa' && S.cid === m.id) renderView(); }); }
  const off_ = P && P.lineups;
  const side = (tid, key) => off_ ? { formation: P.lineups[key].formation, rows: P.lineups[key].rows } : (TICOS.has(tid) ? lastLineup(tid) : null);
  const HL = side(m.hId, 'home'), AL = side(m.aId, 'away');
  const pr = P && P.predictions?.prematch?.length ? P.predictions.prematch[P.predictions.prematch.length - 1].probabilities : null;
  const prob = pr ? (() => { const h = parseFloat(pr.home), d = parseFloat(pr.draw), a = parseFloat(pr.away);
    return `<div class="pred"><div class="bar"><i style="flex:${h};background:var(--accent)"></i><i style="flex:${d};background:var(--draw)"></i><i style="flex:${a};background:var(--away)"></i></div>
      <div class="lab"><span>${esc(H.name)} <b>${Math.round(h)}%</b></span><span>Empate <b>${Math.round(d)}%</b></span><span>${esc(A.name)} <b>${Math.round(a)}%</b></span></div></div>`; })() : '';
  const ida = (D.intl || []).filter(x => x.id !== m.id && x.hs != null && [x.hId, x.aId].sort().join() === [m.hId, m.aId].sort().join());
  const recent = tid => TICOS.has(tid) ? `<div><h3>${esc(T[tid].name)} · últimos 5</h3><ul class="plist">${[...M.filter(x => played(x) && (x.h === tid || x.a === tid)).map(x => ({ d: x.d, h: x.h, a: x.a, hs: off(x).hs, as: off(x).as, hn: T[x.h].name, an: T[x.a].name, c: 'Liga' })),
      ...(D.intl || []).filter(x => x.hs != null && (x.hId === tid || x.aId === tid)).map(x => ({ d: x.d, h: x.hId, a: x.aId, hs: x.hs, as: x.as, hn: x.h.name, an: x.a.name, c: 'Copa' }))]
      .sort((a, b) => new Date(a.d) - new Date(b.d)).slice(-5).reverse().map(x => { const home = x.h === tid, gf = home ? x.hs : x.as, ga = home ? x.as : x.hs, r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
        return `<li><span class="res ${r}">${({W:'G',D:'E',L:'P'})[r]}</span>${home ? 'vs' : 'en'} ${esc(home ? x.an : x.hn)}<span class="x">${gf}–${ga} · ${x.c}</span></li>`; }).join('')}</ul></div>` : '';
  return `<div class="detail cd">${head(`<div class="dnum" style="font-size:40px">${esc(fmtTime(m.d))}</div>`)}
    <div class="dmeta">Previa · ${esc(roundName)} · ${esc(fmtDay(m.d))}${P && P.venue?.name ? ' · ' + esc(P.venue.name) : ''}</div>${prob}
    <div class="pv"><section class="pv-lu"><h3>Alineaciones</h3><p class="lead">${off_ ? '<span class="chip ok">Alineación oficial</span>' : '<span class="chip">Probable</span> la del equipo tico en su último partido con alineación. La oficial sale cerca del pitazo.'}</p>
      <div class="fbar"><span><i class="dot h"></i> ${esc(H.name)}</span><span class="f">${esc(HL?.formation || '')}</span></div>${pitchHtml(HL, AL)}
      <div class="fbar"><span><i class="dot a"></i> ${esc(A.name)}</span><span class="f">${esc(AL?.formation || '')}</span></div></section>
    <div class="pv-data">
      ${ida.length ? `<section><h3>Partido de ida</h3><ul class="plist">${ida.map(x => `<li>${esc(fmtDay(x.d))} · ${esc(x.h.name)} <b>${x.hs}–${x.as}</b> ${esc(x.a.name)}</li>`).join('')}</ul></section>` : ''}
      <section><div class="two">${recent(m.hId)}${recent(m.aId)}</div></section>
      <p class="foot">Las suspensiones de la Copa se rigen por su propio reglamento y no se calculan aquí.</p>
    </div></div></div>`;
}
/* ---------- Legionarios: se actualiza una vez al día (scripts/legionarios.mjs) ---------- */
let LG = null, LGpos = 'Todos', LGsel = null, LGall = false;
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
  for (const p of P) for (const m of fx(p)) { const t = new Date(m.d).getTime(); if (t > now - 2 * 864e5 && t < now + 5 * 864e5) ag.push([m, p]); }
  ag.sort((a, b) => new Date(a[0].d) - new Date(b[0].d));
  const AGMAX = 8;
  const agHtml = ag.length ? `<div class="agenda">${ag.slice(0, LGall ? ag.length : AGMAX).map(([m, p]) => {
      const home = m.h.id == p.teamId, opp = home ? m.a : m.h, sc = scoreOf(m), r = resFor(m, p.teamId), did = didIn(m, p);
      const club = C[p.teamId]?.name || p.club;
      return `<button type="button" class="ag" data-lp="${esc(p.nombre)}"><span class="when"><span>${esc(fmtDay(m.d))} · ${esc(fmtTime(m.d))}</span><small>${esc(m.comp || '')}</small></span>
        <span class="who"><span class="flag" aria-hidden="true">${p.bandera || ''}</span>${esc(p.nombre)}</span>
        <span class="vs">${esc(club)} ${home ? 'vs' : 'en'} ${esc(opp.name)}</span>
        ${r ? `<span class="res"><span class="tag ${r}">${RES[r]} ${home ? sc[0] : sc[1]}–${home ? sc[1] : sc[0]}</span>${did.map(([k, l]) => `<span class="tag ${k}">${esc(l)}</span>`).join('')}</span>` : new Date(m.d).getTime() < now ? '<span class="res">Resultado en la próxima actualización</span>' : ''}</button>`;
    }).join('')}</div>${ag.length > AGMAX ? `<button type="button" class="more lgmore" data-lgall>${LGall ? 'Ver menos' : `Ver los ${ag.length} partidos`}</button>` : ''}` : '<p class="hint">Sin partidos de sus clubes en estos días' + (P.some(p => p.teamId) ? '.' : ' (los calendarios se están cargando; se completan en los próximos días).') + '</p>';
  const ini = n => n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('');
  const form = p => fx(p).filter(m => isFin(m.s) && new Date(m.d) < now).slice(-5).map(m => resFor(m, p.teamId)).filter(Boolean);
  const card = p => {
    const s = p.stats, gk = p.pos === 'Portero', f = form(p), club = C[p.teamId];
    const n = k => s ? (s[k] ?? 0) : '–';
    return `<button type="button" class="pc" data-lp="${esc(p.nombre)}" aria-expanded="${LGsel === p.nombre}">
      <span class="row1">${p.foto ? `<img class="av" src="${esc(p.foto)}" alt="" loading="lazy">` : `<span class="av" aria-hidden="true">${esc(ini(p.nombre))}</span>`}<span class="nm"><b>${esc(p.nombre)}</b><span>${esc(p.pos)}</span></span></span>
      <span class="club">${club?.logo ? `<img class="crest" src="${esc(club.logo)}" alt="" loading="lazy">` : `<span class="flag" aria-hidden="true">${p.bandera || ''}</span>`}${esc(p.club)}${p.nota ? ` <small>(${esc(p.nota)})</small>` : ''} <small>· ${esc(p.pais)}</small></span>
      <span class="stats"><span><b>${n('games')}</b><i>PJ</i></span>${gk ? `<span><b>${n('cleanSheets')}</b><i>Valla inv.</i></span><span><b>${n('conceded')}</b><i>Recibidos</i></span>` : `<span><b>${n('goals')}</b><i>Goles</i></span><span><b>${n('assists')}</b><i>Asist.</i></span>`}<span><b>${n('minutes')}</b><i>Min</i></span></span>
      <span class="last">${f.length ? `Club, últimos ${f.length}: ${f.map(r => `<i class="dot ${r}" title="${RES[r]}"></i>`).join('')}` : 'Club: sin partidos cargados todavía'}</span>
    </button>`;
  };
  const list = P.filter(p => LGpos === 'Todos' || p.pos === LGpos);
  const sel = P.find(p => p.nombre === LGsel);
  const detail = sel ? (() => {
    const s = sel.stats, past = fx(sel).filter(m => new Date(m.d) < now).slice(-8).reverse(), next = fx(sel).filter(m => new Date(m.d) >= now).slice(0, 3);
    return `<section class="panel lpd" id="lpdetail"><div class="ph2"><h2>${esc(sel.nombre)}</h2><button class="more" data-lpclose>Cerrar ✕</button></div>
      <p class="lead">${esc(sel.pos)} · ${esc(sel.club)}${sel.nota ? ` (${esc(sel.nota)})` : ''} · ${esc(sel.pais)} ${sel.bandera || ''}</p>
      ${s ? `<div class="kv">${[['Partidos', s.games], ['Minutos', s.minutes], ...(sel.pos === 'Portero' ? [['Vallas invictas', s.cleanSheets], ['Goles recibidos', s.conceded]] : [['Goles', s.goals], ['Asistencias', s.assists]]), ['Amarillas', s.yc], ['Rojas', s.rc]].map(([k, x]) => `<span><b>${x ?? 0}</b><i>${k}</i></span>`).join('')}</div>
        ${(s.comps || []).length > 1 ? `<p class="foot">Por torneo: ${s.comps.map(c => `${esc(c.league)} ${c.games ?? 0} PJ${c.goals ? ', ' + c.goals + (c.goals === 1 ? ' gol' : ' goles') : ''}`).join(' · ')}</p>` : ''}` : '<p class="hint">Sus números de la temporada aparecen en la próxima actualización.</p>'}
      ${next.length ? `<h3>Próximos partidos</h3><ul class="lms">${next.map(m => lgMatchLine(m, sel)).join('')}</ul>` : ''}
      ${past.length ? `<h3>Últimos partidos de su club</h3><ul class="lms">${past.map(m => lgMatchLine(m, sel)).join('')}</ul>` : ''}
      <p class="foot">Goles, tarjetas y cambios salen del minuto a minuto del partido; si no aparece nada, puede que no haya jugado o que la API no tenga ese detalle para esa liga.</p></section>`;
  })() : '';
  const upd = LG.updated ? new Date(LG.updated).toLocaleString('es-CR', { ...tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  v.innerHTML = `<div class="lg">
    <div class="lgh"><h2>Legionarios</h2><span>Ticos que juegan en el exterior · ${P.length} jugadores${upd ? ` · actualizado ${esc(upd)}` : ''}</span></div>
    <section class="panel"><div class="ph2"><h2>Esta semana</h2></div><p class="lead">Partidos de sus clubes de los últimos 2 días y los próximos 5, en hora de Costa Rica. Se actualiza una vez al día, de madrugada.</p>${agHtml}</section>
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
  v.querySelector('[data-lgall]')?.addEventListener('click', () => { LGall = !LGall; renderView(); });
  v.querySelector('[data-lpclose]')?.addEventListener('click', () => { LGsel = null; renderView(); });
}
function go(view) { S.view = view; try { history.replaceState(null, '', '#' + view); } catch(e){} renderView(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.v));

/* Si el minuto a minuto tiene más goles que el marcador (gol anulado que la API no ha borrado),
   el marcador manda y los goles sobrantes, de atrás para adelante, se marcan como anulados. */
function reconcile(events, hs, as) {
  const ev = events.map(e => e.slice());
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
  const now = LIVE.filter(x => x.started && !x.finished);
  const soon = LIVE.filter(x => !x.started);
  if (!now.length && !soon.length) { el.hidden = true; syncBoard(); return; }
  el.hidden = false; syncBoard();
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="">` : `<span class="crest ph" aria-hidden="true">${esc(t.ab)}</span>`;
  const item = L => {
    const [hs, as] = (L.score || '0 - 0').split(' - ');
    const evs = reconcile(L.events, +hs, +as);
    const e = evs[evs.length - 1];
    const last = e ? `${esc(e[0])}' · ${e[1] === 'sub' ? `Entra <b>${esc(e[4])}</b> <span class="note">sale ${esc(e[3])}</span>` : `<b>${esc(e[3] || '')}</b> <span class="note">${EVL[e[1]] || esc(e[1])}</span>`}` : 'Sin eventos todavía';
    const clock = /half time/i.test(L.status) ? 'ENTRETIEMPO' : `EN VIVO ${L.clock ?? ''}'`;
    const inLeague = M.some(x => x.id === L.id) || (D.intl || []).some(x => x.id === L.id);
    return `<${inLeague ? `button type="button" class="litem" data-live="${L.id}"` : 'div class="litem"'}>${L.started ? `<span class="tag"><i></i>${clock}</span>` : `<span class="tag soon">${esc(fmtTime(L.d))}</span>`}
      <span class="sc">${cr(L.h)}<span>${esc(L.h.name)}</span><b>${L.started ? `${hs} – ${as}` : 'vs'}</b><span>${esc(L.a.name)}</span>${cr(L.a)}</span>
      <span class="comp">${esc(COMP[L.comp] || L.comp)}</span>${L.started ? `<span class="last">Último: ${last}</span>` : ''}${inLeague ? '<span class="go">Ver partido →</span>' : ''}</${inLeague ? 'button' : 'div'}>`;
  };
  el.innerHTML = [...now, ...soon].map(item).join('');
  el.querySelectorAll('[data-live]').forEach(b => b.onclick = () => {
    const m = M.find(x => x.id === +b.dataset.live);
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
  renderLive(); renderBoard();
  // la tabla y los goleadores también usan los resultados recién terminados
  if (S.view === 'inicio' || S.view === 'tabla' || S.view === 'copa') renderView();
}
renderLive(); renderBoard(); renderView();
pollLive(); setInterval(pollLive, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
}
let LIVE = [];
fetch('/data/season.json', { cache: 'no-cache' }).then(r => r.json()).then(start).catch(() => {
  document.getElementById('view').innerHTML = '<p class="hint">No se pudieron cargar los datos. Recargá la página.</p>';
});
