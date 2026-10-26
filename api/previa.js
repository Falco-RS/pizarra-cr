// Previa de un partido: estadio, árbitro, clima, pronóstico, alineaciones, últimos 5 y cara a cara.
// Uso: /api/previa?id=ID_DEL_PARTIDO
// Vercel guarda la respuesta 10 minutos (5 cuando ya hay alineaciones), así que se gasta poco del plan.

const BASE = 'https://soccer.highlightly.net';

export default async function handler(req, res) {
  const key = process.env.HIGHLIGHTLY_KEY || process.env.HIGHLIGHT_KEY;
  const id = String(req.query?.id || new URL(req.url, 'http://x').searchParams.get('id') || '').replace(/\D/g, '');
  const send = (code, body, ttl) => {
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=120`);
    res.status(code).json(body);
  };
  if (!key) return send(500, { error: 'Falta HIGHLIGHTLY_KEY en Vercel' }, 60);
  if (!id) return send(400, { error: 'Falta el id del partido' }, 60);

  // Solo partidos de nuestros torneos: el servicio no puede usarse como acceso abierto a la API
  // (los términos de Highlightly prohíben revender o reenviar el acceso directo a su API).
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
    const season = await (await fetch(`${proto}://${host}/data/season.json`)).json();
    const known = new Set([...season.matches.map(m => String(m.id)), ...(season.intl || []).map(m => String(m.id))]);
    if (!known.has(id)) return send(404, { error: 'Partido no disponible en Pizarra CR' }, 3600);
  } catch (e) {
    return send(503, { error: 'No se pudo verificar el partido' }, 30);
  }

  const api = async p => {
    const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': key } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} ${p}`);
    return r.json();
  };

  try {
    const raw = await api(`/matches/${id}`);
    const m = Array.isArray(raw) ? raw[0] : raw;
    if (!m) return send(404, { error: 'Partido no encontrado' }, 300);
    const h = m.homeTeam.id, a = m.awayTeam.id;
    // Últimos 5 y cara a cara los calcula la página con nuestros datos: aquí solo alineación oficial.
    const kickoff = new Date(m.date).getTime();
    const near = kickoff - Date.now() < 2 * 3600e3;
    const lineups = near ? await api(`/lineups/${id}`).catch(() => null) : null;
    const slim = g => (g || []).map(x => ({
      id: x.id, date: x.date, league: x.league?.name, round: x.round,
      h: { id: x.homeTeam?.id, name: x.homeTeam?.name, logo: x.homeTeam?.logo },
      a: { id: x.awayTeam?.id, name: x.awayTeam?.name, logo: x.awayTeam?.logo },
      score: x.state?.score?.current || null, status: x.state?.description,
    }));
    const side = t => t ? ({
      formation: t.formation || null,
      rows: (t.initialLineup || []).map(row => row.map(p => ({ id: p.id, n: p.number, name: p.name, pos: p.position }))),
      subs: (t.substitutes || []).map(p => ({ id: p.id, n: p.number, name: p.name, pos: p.position })),
    }) : null;
    const hasLineups = !!(lineups?.homeTeam?.initialLineup?.length);
    send(200, {
      id: m.id, date: m.date, round: m.round, league: m.league?.name,
      status: m.state?.description, clock: m.state?.clock ?? null, score: m.state?.score?.current || null,
      home: { id: h, name: m.homeTeam.name, logo: m.homeTeam.logo, topPlayers: m.homeTeam.topPlayers || [] },
      away: { id: a, name: m.awayTeam.name, logo: m.awayTeam.logo, topPlayers: m.awayTeam.topPlayers || [] },
      venue: m.venue || null, referee: m.referee || null, forecast: m.forecast || null,
      predictions: m.predictions || null, news: (m.news || []).slice(0, 6),
      lineups: hasLineups ? { home: side(lineups.homeTeam), away: side(lineups.awayTeam) } : null,
    }, hasLineups ? 3600 : near ? 600 : 6 * 3600);
  } catch (e) {
    send(502, { error: e.message }, 30);
  }
}
