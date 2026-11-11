# Battleship SSR (Part A reference solution)

Multiplayer Battleship that is server-rendered, uses HTMX for partial updates, and uses server-sent events (SSE) for live play. This is the Part A reference solution from `../ssr-multiplayer-assignment-plan.md`.

## Run it

```sh
npm install
npm start          # http://localhost:3000 (set PORT to change)
npm test           # unit tests plus integration tests (incl. SSE streams)
npm run typecheck
```

To play against yourself, use two browser profiles, or open `http://localhost:3000` and `http://127.0.0.1:3000` (cookies are per host, so these are two different players).

## What it demonstrates

| Idea | Where |
| --- | --- |
| Server-side rendering | `src/views.ts` renders every page and fragment; `view-source` shows real content |
| Safe-by-default templating | `src/html.ts` escapes every interpolation unless it is already `SafeHtml` |
| Post/Redirect/Get | `POST /games`, `/name`, `/games/:id/join`, and non-HTMX `/fire` all redirect with 303 |
| HTMX partial updates | The opponent board is a `<form hx-post>`; the server answers with the `#game-panel` fragment |
| Progressive enhancement | The same form works without JS (plain POST, redirect, full page) |
| Hidden state stays on the server | `viewBoard(board, revealShips)` in `src/game.ts`; only a board's owner gets `ship` cells |
| Server validates everything | Turn order, bounds, repeated cells, spectators, malformed input (`GameError` with a status) |
| SSE fan-out | `src/hub.ts` keeps per-channel clients and renders role-specific HTML for each |
| SSE hygiene | Heartbeat comment, cleanup on `close`, snapshot on connect, event `id` = game version |
| Pure rules module | `src/game.ts` has no HTTP and no mutation, and is unit tested |

## Layout

```text
src/
  game.ts         pure rules (ships, shots, turns, views)
  html.ts         html`` template tag + escaping
  views.ts        pages and fragments
  store.ts        in-memory games (Part B: SQLite)
  hub.ts          SSE connections per channel
  identity.ts     name cookie + requireName guard
  routes/         identity, lobby, games
  app.ts          express wiring, static files, 404 and error handlers
  index.ts        server entry
public/styles.css all styling (no inline styles anywhere)
```

## Routes

| Method and path | Purpose |
| --- | --- |
| `GET /` | Name form |
| `POST /name` | Set the name cookie, redirect to `next` (same-site paths only) |
| `GET /lobby` | Server-rendered game list |
| `GET /lobby/events` | SSE: `games` events with the lobby list |
| `POST /games` | Create a game, redirect to it |
| `GET /games/:id` | Game page (404 page if unknown) |
| `POST /games/:id/join` | Become the second player |
| `POST /games/:id/fire` | Body `cell=row,col`; HTMX gets the panel fragment, others get a redirect |
| `GET /games/:id/events` | SSE: `panel` events with HTML for that viewer's role |

## Deliberately weak (Part B fixes these)

- **Identity is a plain cookie.** Anyone can send `Cookie: player=Ana` and move as Ana. Part B adds registration, hashed passwords, sessions, and per-game authorization.
- **No CSRF protection.** State-changing POSTs trust any same-site cookie request.
- **Everything is in memory.** A restart loses all games; two server processes would not share SSE connections or state.
- **No rate limiting** on creating games or opening SSE connections.
- **Output is properly escaped here**, so there is no XSS to find. For the Part B "demonstrate an XSS bug" exercise, the student starter should plant one (for example an unescaped name in the lobby row) so there is something to exploit and fix.

## Not verified

The HTMX and SSE behavior has not been exercised in a real browser yet (the automation extension was not connected when this was built). The server side is covered by `src/app.test.ts`, which opens real SSE streams for two players and a spectator and asserts that no one but the owner ever receives ship positions. Do a manual two-window playthrough before handing this to students.
