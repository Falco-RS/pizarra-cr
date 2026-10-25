// Partidos en vivo. Vercel guarda la respuesta en caché y se la sirve igual a todos los visitantes,
// así que la API de Highlightly se consulta como máximo una vez por intervalo, sin importar cuánta gente entre.
// Si no hay ningún partido cerca de jugarse, no se gasta ninguna consulta.

const BASE = 'https://soccer.highlightly.net';
const TYPE = {
  'Goal': 'goal', 'Penalty': 'pen', 'Own Goal': 'og', 'Yellow Card': 'yc', 'Red Card': 'rc',
  'Substitution': 'sub', 'Missed Penalty': 'mp', 'VAR Goal Cancelled': 'var',
};
const BEFORE = 60 * 60e3;   // empezar a mirar 1 h antes (por si adelantaron el partido)
const AFTER = 150 * 60e3;   // y hasta 2 h 30 después

export default async function handler(req, res) {
  const key = process.env.HIGHLIGHTLY_KEY || process.env.HIGHLIGHT_KEY;
  const liveTtl = Number(process.env.LIVE_CACHE_SECONDS || 60);
  const send = (body, ttl) => {
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=30`);
    res.status(200).json(body);
  };
  if (!key) return send({ error: 'Falta HIGHLIGHTLY_KEY en Vercel', live: [] }, 60);

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
    const season = await (await fetch(`${proto}://${host}/data/season.json`)).json();

    const now = Date.now();
    const done = s => /finish|award|cancel|postpon|abandon/i.test(s || '');
    const candidates = [
      ...season.matches.map(m => ({ id: m.id, d: m.d, s: m.s, leagueId: season.league.id, comp: season.league.name, h: season.teams[m.h], a: season.teams[m.a] })),
      ...(season.intl || []).map(m => ({ id: m.id, d: m.d, s: m.s, leagueId: m.leagueId, comp: m.comp, h: m.h, a: m.a })),
    // En juego, o ya terminado pero todavía sin guardar en los datos (hasta 24 h después),
    // para que la página siga mostrando el resultado final mientras corre la actualización.
    ].filter(m => { const k = new Date(m.d).getTime(); return now >= k - BEFORE && now <= k + 24 * 3600e3 && !done(m.s); });

    if (!candidates.length) return send({ updated: new Date().toISOString(), live: [] }, 300);

    // Estado y marcador: una consulta por torneo y día
    const groups = new Map();
    for (const m of candidates) {
      const day = new Date(m.d).toISOString().slice(0, 10);
      const k = `${m.leagueId}|${day}`;
      if (!groups.has(k)) groups.set(k, { leagueId: m.leagueId, day, ids: new Set() });
      groups.get(k).ids.add(m.id);
    }
    const api = async p => {
      const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': key } });
      if (!r.ok) throw new Error(`${r.status} ${p}`);
      return r.json();
    };
    const states = new Map();
    for (const g of groups.values()) {
      const page = await api(`/matches?leagueId=${g.leagueId}&date=${g.day}&limit=100`);
      for (const m of page?.data || []) if (g.ids.has(m.id)) states.set(m.id, m);
    }

    const live = [];
    for (const c of candidates) {
      const m = states.get(c.id);
      if (!m) continue;
      const st = m.state || {};
      // pasado el tiempo normal y sin empezar: suspendido o con datos atrasados, no se muestra
      if (/not started/i.test(st.description || '') && now > new Date(c.d).getTime() + AFTER) continue;
      const started = !/not started/i.test(st.description || '');
      let events = [], stats = [];
      if (started) {
        // una sola consulta trae eventos y estadísticas
        const raw = await api(`/matches/${c.id}`);
        const full = Array.isArray(raw) ? raw[0] : raw;
        events = (full?.events || []).map(e => [String(e.time), TYPE[e.type] || e.type, e.team?.id === m.homeTeam.id ? 1 : 0, e.player, e.substituted]);
        stats = (full?.statistics || []).map(t => ({ t: t.team?.id, s: Object.fromEntries((t.statistics || []).map(x => [x.displayName, x.value])) }));
      }
      live.push({ id: c.id, comp: c.comp, d: c.d, h: c.h, a: c.a, score: st.score?.current || null, clock: st.clock ?? null, status: st.description || '', started, finished: done(st.description), events, stats });
    }
    // Un partido terminó y todavía no está en los datos: pedir la actualización a GitHub ya
    // (necesita GH_TOKEN en Vercel; sin él, la actualización horaria lo recoge igual).
    const pendingSave = live.some(m => m.finished);
    if (pendingSave && process.env.GH_TOKEN) {
      await fetch('https://api.github.com/repos/' + (process.env.GH_REPO || 'Falco-RS/pizarra-cr') + '/actions/workflows/actualizar-datos.yml/dispatches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pizarra-cr' },
        body: JSON.stringify({ ref: 'main' }),
      }).catch(() => {});
    }
    // en juego: el intervalo normal; nada en juego todavía: 10 min; solo terminados esperando guardarse: 1 h
    const anyStarted = live.some(m => m.started && !m.finished);
    const ttl = anyStarted ? liveTtl : live.some(m => !m.started) ? Math.max(liveTtl, 600) : 3600;
    send({ updated: new Date().toISOString(), live }, ttl);
  } catch (e) {
    send({ error: e.message, live: [] }, 30);
  }
}
