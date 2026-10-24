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
const off = m => MESA[m.id] || m;
const M = D.matches.slice().sort((a,b) => new Date(a.d) - new Date(b.d));
const rounds = [...new Set(M.map(m => m.r))].sort((a,b) => a-b);
const lastPlayed = Math.max(...M.filter(played).map(m => m.r));

const soonRound = M.filter(m => !played(m) && new Date(m.d) - Date.now() < 3 * 864e5).map(m => m.r);
const currentRound = soonRound.length && M.filter(m => m.r === lastPlayed).every(played) ? Math.min(...soonRound) : lastPlayed;
let S = { view:'inicio', j:currentRound, sel:null, tmode:'total', moved:false };
try { const v = location.hash.slice(1); if (['inicio','tabla','goleadores','disciplina'].includes(v)) S.view = v; } catch(e){}

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
  const rows = D.standings.map(s => { const o = s[mode]; return { t: s.t, pj: o.games, g: o.wins, e: o.draws, p: o.loses, gf: o.scoredGoals, gc: o.receivedGoals, pts: mode === 'total' ? s.pts : o.wins*3 + o.draws }; });
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
    const lv = LIVE.find(x => x.id === m0.id && x.started && !x.finished);
    const m = lv ? { ...m0, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: lv.events, liveClock: lv.clock } : m0;
    const p = played(m), hl = p && !lv && m.hs < m.as, al = p && !lv && m.as < m.hs;
    return `<button class="mc" data-id="${m.id}" aria-pressed="${S.sel === m.id}" ${p ? '' : 'aria-disabled="true"'}>
      <span class="meta"><span>${esc(fmtDay(m.d))}</span><span>${esc(statusLine(m))}</span></span>
      <span class="row ${hl ? 'lose' : ''}">${crest(m.h)}<span>${esc(T[m.h].name)}</span><span class="sc">${p ? m.hs : ''}</span></span>
      <span class="row ${al ? 'lose' : ''}">${crest(m.a)}<span>${esc(T[m.a].name)}</span><span class="sc">${p ? m.as : ''}</span></span>
    </button>`;
  }).join('');
  document.querySelectorAll('.mc').forEach(b => b.onclick = () => {
    const id = +b.dataset.id, m = M.find(x => x.id === id);
    if (!played(m) && !LIVE.some(x => x.id === id && x.started)) return;
    S.sel = S.sel === id ? null : id; renderBoard();
  });
  renderDetail();
}

const EVL = { goal:'Gol', pen:'Gol de penal', og:'Autogol', yc:'Amarilla', rc:'Roja', sub:'Cambio', mp:'Penal fallado', var:'Gol anulado por VAR' };
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
  const m = lv ? { ...base, hs: +lv.score.split(' - ')[0], as: +lv.score.split(' - ')[1], ev: lv.events, liveClock: lv.finished ? undefined : lv.clock } : base;
  if (!m) { box.innerHTML = `<p class="hint" style="background:transparent;color:var(--board-muted);padding:0;margin:0">Tocá un partido jugado para ver goles, tarjetas y cambios minuto a minuto.</p>`; return; }
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

function renderView() {
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
function go(view) { S.view = view; try { history.replaceState(null, '', '#' + view); } catch(e){} renderView(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.v));

const COMP = { 'Concacaf Central American Cup': 'Copa Centroamericana', 'CONCACAF Champions Cup': 'Copa de Campeones Concacaf' };
function renderLive() {
  const el = document.getElementById('live');
  const now = LIVE.filter(x => x.started && !x.finished);
  const soon = LIVE.filter(x => !x.started);
  if (!now.length && !soon.length) { el.hidden = true; return; }
  el.hidden = false;
  const cr = t => t.logo ? `<img class="crest" src="${esc(t.logo)}" alt="">` : `<span class="crest ph" aria-hidden="true">${esc(t.ab)}</span>`;
  const item = L => {
    const [hs, as] = (L.score || '0 - 0').split(' - ');
    const e = L.events[L.events.length - 1];
    const last = e ? `${esc(e[0])}' · ${e[1] === 'sub' ? `Entra <b>${esc(e[4])}</b> <span class="note">sale ${esc(e[3])}</span>` : `<b>${esc(e[3] || '')}</b> <span class="note">${EVL[e[1]] || esc(e[1])}</span>`}` : 'Sin eventos todavía';
    const clock = /half time/i.test(L.status) ? 'ENTRETIEMPO' : `EN VIVO ${L.clock ?? ''}'`;
    const inLeague = M.some(x => x.id === L.id);
    return `<${inLeague ? `button type="button" class="litem" data-live="${L.id}"` : 'div class="litem"'}>${L.started ? `<span class="tag"><i></i>${clock}</span>` : `<span class="tag soon">${esc(fmtTime(L.d))}</span>`}
      <span class="sc">${cr(L.h)}<span>${esc(L.h.name)}</span><b>${L.started ? `${hs} – ${as}` : 'vs'}</b><span>${esc(L.a.name)}</span>${cr(L.a)}</span>
      <span class="comp">${esc(COMP[L.comp] || L.comp)}</span>${L.started ? `<span class="last">Último: ${last}</span>` : ''}${inLeague ? '<span class="go">Ver partido →</span>' : ''}</${inLeague ? 'button' : 'div'}>`;
  };
  el.innerHTML = [...now, ...soon].map(item).join('');
  el.querySelectorAll('[data-live]').forEach(b => b.onclick = () => {
    const m = M.find(x => x.id === +b.dataset.live); if (!m) return;
    S.j = m.r; S.sel = m.id; S.moved = true; renderBoard();
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
async function pollLive() {
  if (document.hidden) return;
  try {
    const r = await fetch('/api/live', { cache: 'no-store' });
    const j = await r.json();
    LIVE = j.live || [];
    const lvM = LIVE.map(x => M.find(m => m.id === x.id && x.started && !x.finished)).find(Boolean);
    if (lvM && !S.moved) S.j = lvM.r;
  } catch (e) { /* sin conexión: se mantiene lo último */ }
  renderLive(); renderBoard();
}
renderLive(); renderBoard(); renderView();
pollLive(); setInterval(pollLive, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
}
let LIVE = [];
fetch('/data/season.json', { cache: 'no-cache' }).then(r => r.json()).then(start).catch(() => {
  document.getElementById('view').innerHTML = '<p class="hint">No se pudieron cargar los datos. Recargá la página.</p>';
});
