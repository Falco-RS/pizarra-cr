# Pizarra CR

Resultados, tabla, goleadores, disciplina y partidos en vivo del fútbol de Costa Rica.
Datos de [Highlightly](https://highlightly.net).

## Cómo funciona

| Parte | Archivo | Qué hace |
|---|---|---|
| Página | `public/index.html`, `app.js`, `styles.css` | Lee `public/data/season.json` y consulta `/api/live` cada minuto. |
| Datos del torneo | `scripts/update.mjs` | Baja partidos, tabla, minuto a minuto, alineaciones y estadísticas. Solo pide lo nuevo. |
| Actualización automática | `.github/workflows/actualizar-datos.yml` | Corre el script cada 3 horas y guarda los cambios. Vercel publica solo. |
| En vivo | `api/live.js` | Si hay un partido en juego, consulta marcador y eventos. Vercel guarda la respuesta y se la da igual a todos los visitantes. Sin partidos cerca, no gasta consultas. |
| Correcciones | `data/correcciones.json` | Resultados cambiados por el tribunal (ganados en la mesa). |

## Configuración (una sola vez)

1. **Vercel** → Project → Settings → Environment Variables:
   - `HIGHLIGHTLY_KEY` = tu llave de Highlightly
   - `LIVE_CACHE_SECONDS` = `300` con el plan gratis, `60` con un plan pagado
2. **GitHub** → el repositorio → Settings → Secrets and variables → Actions → New repository secret:
   - `HIGHLIGHTLY_KEY` = la misma llave

## Tareas comunes

- **Actualizar ya:** GitHub → Actions → "Actualizar datos" → Run workflow.
- **Partido ganado en la mesa:** agregalo a `data/correcciones.json` con el id del partido:
  ```json
  { "1320453232": { "hs": 3, "as": 0, "note": "Explicación que se muestra en el partido." } }
  ```
- **Nuevo torneo (Clausura):** cambiá `SEASON` o `LEAGUE_ID` en `scripts/update.mjs`.

## Consultas a la API

- Cada actualización: ~4 consultas fijas + 3 por cada partido recién terminado.
- En vivo: 1 por torneo + 1 por partido en juego, una vez por intervalo.
- El plan gratis (100/día) alcanza para todo menos el en vivo de una jornada completa. Para eso, el plan de $9.49/mes.
