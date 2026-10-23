// Partidos en vivo. Vercel guarda la respuesta en caché y se la sirve igual a todos los visitantes,
// así que la API de Highlightly se consulta como máximo una vez por intervalo, sin importar cuánta gente entre.
// Si no hay ningún partido cerca de jugarse, no se gasta ninguna consulta.

const BASE = 'https://soccer.highlightly.net';
const TYPE = {
  'Goal': 'goal', 'Penalty': 'pen', 'Own Goal': 'og', 'Yellow Card': 'yc', 'Red Card': 'rc',
  'Substitution': 'sub', 'Missed Penalty': 'mp', 'VAR Goal Cancelled': 'var',
};
const BEFORE = 10 * 60e3;   // empezar a mirar 10 min antes del pitazo
const AFTER = 150 * 60e3;   // y hasta 2 h 30 después

export default async function handler(req, res) {
  const key = process.env.HIGHLIGHTLY_KEY;
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
    ].filter(m => { const k = new Date(m.d).getTime(); return now >= k - BEFORE && now <= k + AFTER && !done(m.s); });

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
      const started = !/not started/i.test(st.description || '');
      let events = [];
      if (started) {
        const ev = await api(`/events/${c.id}`);
        events = (ev || []).map(e => [String(e.time), TYPE[e.type] || e.type, e.team?.id === m.homeTeam.id ? 1 : 0, e.player, e.substituted]);
      }
      live.push({ id: c.id, comp: c.comp, d: c.d, h: c.h, a: c.a, score: st.score?.current || null, clock: st.clock ?? null, status: st.description || '', started, finished: done(st.description), events });
    }
    send({ updated: new Date().toISOString(), live }, liveTtl);
  } catch (e) {
    send({ error: e.message, live: [] }, 30);
  }
}
