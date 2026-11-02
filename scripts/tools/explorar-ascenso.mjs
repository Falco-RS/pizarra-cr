// Solo consulta: ¿qué trae Highlightly de la Liga de Ascenso de Costa Rica? No guarda nada ni toca la página.
const KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = 'https://soccer.highlightly.net';
const api = async p => { const r = await fetch(BASE + p, { headers: { 'x-rapidapi-key': KEY } }); console.log(`[${r.status}] ${p}`); return r.ok ? r.json() : null; };
const out = x => console.log(JSON.stringify(x, null, 1).slice(0, 3000));

let leagues = [];
for (const q of ['countryName=Costa%20Rica', 'countryCode=CR', 'leagueName=Liga%20de%20Ascenso', 'leagueName=Segunda']) {
  const r = await api(`/leagues?${q}&limit=100`);
  const list = r?.data || [];
  console.log(`  ${list.length} ligas`);
  for (const l of list) console.log(`  - ${l.id} | ${l.name} | ${l.country?.name} | temporadas: ${(l.seasons || []).map(s => s.season).join(',')}`);
  leagues.push(...list);
}
const asc = leagues.filter(l => /ascenso|segunda|second/i.test(l.name) && /costa/i.test(l.country?.name || ''));
const uniq = [...new Map(asc.map(l => [l.id, l])).values()];
console.log('\n== Ligas de ascenso encontradas:', uniq.map(l => `${l.id} ${l.name}`));
for (const l of uniq) {
  for (const season of [2026, 2025]) {
    const m = await api(`/matches?leagueId=${l.id}&season=${season}&limit=100`);
    const list = m?.data || [];
    console.log(`\n${l.name} temporada ${season}: ${list.length} partidos (total ${m?.pagination?.totalCount ?? '?'})`);
    const st = {}; list.forEach(x => st[x.state?.description] = (st[x.state?.description] || 0) + 1); console.log('  estados:', st);
    const rounds = [...new Set(list.map(x => x.round))]; console.log('  rondas:', rounds.slice(0, 40));
    list.slice(-8).forEach(x => console.log(`  ${x.date?.slice(0, 10)} ${x.round} | ${x.homeTeam?.name} ${x.state?.score?.current ?? ''} ${x.awayTeam?.name} | ${x.state?.description}`));
    const fin = list.filter(x => /finish/i.test(x.state?.description || '')).slice(-1)[0];
    if (fin) { const d = await api(`/matches/${fin.id}`); const x = Array.isArray(d) ? d[0] : d; console.log(`  detalle ${fin.id}: ${x?.events?.length ?? 0} eventos, estadísticas: ${(x?.statistics || []).length}`); (x?.events || []).slice(0, 6).forEach(e => console.log(`    ${e.time} ${e.type} ${e.player}`)); }
    const s = await api(`/standings?leagueId=${l.id}&season=${season}`);
    console.log('  tabla:', (s?.groups || []).map(g => `${g.name}: ${(g.standings || []).length} equipos`));
    if (list.length) break;
  }
}
