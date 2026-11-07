// Solo consulta: muestra lo que la API tiene de un partido (eventos, estadísticas y alineaciones). No guarda nada.
const KEY = process.env.HIGHLIGHTLY_KEY, ID = process.env.MATCH_ID;
const api = async p => { const r = await fetch('https://soccer.highlightly.net' + p, { headers: { 'x-rapidapi-key': KEY } }); return r.ok ? r.json() : `[${r.status}]`; };
const m = await api(`/matches/${ID}`); const x = Array.isArray(m) ? m[0] : m;
console.log('ESTADO:', x?.state?.description, x?.state?.clock, x?.state?.score?.current);
console.log('EVENTOS:', JSON.stringify((x?.events || []).map(e => [e.time, e.type, e.team?.name, e.player, e.assist, e.substituted])));
console.log('ESTADISTICAS:', JSON.stringify(x?.statistics || []).slice(0, 1500));
console.log('VENUE/REFEREE:', JSON.stringify({ venue: x?.venue, referee: x?.referee }));
const l = await api(`/lineups/${ID}`);
console.log('ALINEACIONES:', JSON.stringify(l).slice(0, 3000));
