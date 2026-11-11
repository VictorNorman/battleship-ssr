import {
  BOARD_SIZE,
  coordLabel,
  seatOf,
  viewBoard,
  type CellView,
  type Game,
} from './game.js';
import { html, SafeHtml } from './html.js';

// Server-side views. Each function returns HTML for one page or fragment.
// Pages are for full navigations; panels and lists are fragments that HTMX
// swaps in (from POST responses and from SSE events).

// HTMX ignores 4xx responses by default; this tells it to swap them in too, so
// an error such as "not your turn" can render as part of the panel.
const HTMX_CONFIG = JSON.stringify({
  responseHandling: [
    {
      code: '204',
      swap: false,
    },
    {
      code: '[23]..',
      swap: true,
    },
    {
      code: '[45]..',
      swap: true,
      error: true,
    },
    {
      code: '...',
      swap: true,
    },
  ],
});

export const layoutPage = (
  title: string,
  viewer: string | null,
  body: SafeHtml,
): SafeHtml => {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="htmx-config" content="${HTMX_CONFIG}" />
    <title>${title} · Battleship</title>
    <link rel="stylesheet" href="/styles.css" />
    <script src="/vendor/htmx/htmx.min.js" defer></script>
    <script src="/vendor/htmx-ext-sse/sse.min.js" defer></script>
  </head>
  <body hx-ext="sse">
    <header class="site-header">
      <a class="site-title" href="/lobby">Battleship</a>
      ${viewer === null
        ? ''
        : html`<span class="who">Playing as <strong>${viewer}</strong> · <a href="/">change name</a></span>`}
    </header>
    <main>${body}</main>
  </body>
</html>`;
};

// ---------- name picker ----------

export const namePage = (
  current: string | null,
  next: string,
  error: string | null,
): SafeHtml => {
  return layoutPage(
    'Choose a name',
    current,
    html`<section class="card narrow">
      <h1>Choose a display name</h1>
      ${error === null ? '' : html`<p class="notice notice--error" role="alert">${error}</p>`}
      <form method="post" action="/name" class="stack">
        <input type="hidden" name="next" value="${next}" />
        <label for="name">Name (1 to 24 characters)</label>
        <input id="name" name="name" value="${current ?? ''}" maxlength="24" required autofocus />
        <button type="submit">Continue</button>
      </form>
    </section>`,
  );
};

// ---------- lobby ----------

const statusLabel = (game: Game): string => {
  if (game.status === 'waiting') {
    return 'Waiting for an opponent';
  }
  if (game.status === 'over') {
    return `Finished, ${game.winner} won`;
  }
  return 'In progress';
};

const lobbyAction = (game: Game, viewer: string | null): SafeHtml => {
  if (seatOf(game, viewer) !== -1) {
    return html`<a class="button" href="/games/${game.id}">Open</a>`;
  }
  if (game.status === 'waiting') {
    return html`<form method="post" action="/games/${game.id}/join">
      <button type="submit">Join</button>
    </form>`;
  }
  return html`<a class="button button--secondary" href="/games/${game.id}">Watch</a>`;
};

export const lobbyList = (games: Game[], viewer: string | null): SafeHtml => {
  if (games.length === 0) {
    return html`<p class="muted">No games yet. Create one to get started.</p>`;
  }
  return html`<ul class="game-list">
    ${games.map((game) => {
      return html`<li class="game-row">
        <div>
          <strong>${game.players.map((player) => player.name).join(' vs ')}</strong>
          <span class="muted">${statusLabel(game)}</span>
        </div>
        ${lobbyAction(game, viewer)}
      </li>`;
    })}
  </ul>`;
};

export const lobbyPage = (games: Game[], viewer: string): SafeHtml => {
  return layoutPage(
    'Lobby',
    viewer,
    html`<section class="card">
      <h1>Lobby</h1>
      <form method="post" action="/games">
        <button type="submit">Create a new game</button>
      </form>
    </section>
    <section class="card">
      <h2>Games</h2>
      <div id="lobby" sse-connect="/lobby/events" sse-swap="games">
        ${lobbyList(games, viewer)}
      </div>
    </section>`,
  );
};

// ---------- game ----------

const COLUMN_LETTERS = Array.from(
  {
    length: BOARD_SIZE,
  },
  (_, col) => {
    return String.fromCharCode(65 + col);
  },
);

const CELL_DESCRIPTIONS: Record<CellView, string> = {
  water: 'open water',
  ship: 'your ship',
  hit: 'hit',
  miss: 'miss',
  sunk: 'sunk ship',
};

const CELL_SYMBOLS: Record<CellView, string> = {
  water: '',
  ship: '',
  hit: '✕',
  miss: '•',
  sunk: '✕',
};

const cellHtml = (
  cell: CellView,
  row: number,
  col: number,
  fireable: boolean,
): SafeHtml => {
  const label = coordLabel({
    row,
    col,
  });
  if (fireable && cell === 'water') {
    return html`<button
      type="submit"
      name="cell"
      value="${row},${col}"
      class="cell cell--water cell--fireable"
      aria-label="Fire at ${label}"
    ></button>`;
  }
  return html`<span
    class="cell cell--${cell}"
    role="img"
    aria-label="${label}: ${CELL_DESCRIPTIONS[cell]}"
    >${CELL_SYMBOLS[cell]}</span
  >`;
};

const boardHtml = (title: string, cells: CellView[][], fireable: boolean): SafeHtml => {
  return html`<section class="board-wrap">
    <h3>${title}</h3>
    <div class="board">
      <span class="board__label"></span>
      ${COLUMN_LETTERS.map((letter) => html`<span class="board__label">${letter}</span>`)}
      ${cells.map((cellRow, row) => {
        return html`<span class="board__label">${row + 1}</span>${cellRow.map((cell, col) => {
          return cellHtml(cell, row, col, fireable);
        })}`;
      })}
    </div>
  </section>`;
};

const statusText = (game: Game, seat: number): string => {
  if (game.status === 'waiting') {
    return 'Waiting for an opponent to join…';
  }
  if (game.status === 'over') {
    return `${game.winner} wins!`;
  }
  const current = game.players[game.turn].name;
  if (seat === -1) {
    return `${current}'s turn.`;
  }
  return seat === game.turn
    ? 'Your turn: pick a cell to fire at.'
    : `Waiting for ${current} to fire…`;
};

// The contents of #game-panel. This is the fragment that both the initial page
// render and every SSE event / POST response swap in. The `viewer` decides what
// is revealed: ship positions are only ever passed to a board's owner.
export const gamePanel = (
  game: Game,
  viewer: string | null,
  notice: string | null = null,
): SafeHtml => {
  const seat = seatOf(game, viewer);
  const myTurn = game.status === 'playing' && seat === game.turn;

  let boards: SafeHtml;
  if (seat === -1) {
    boards = html`${game.players.map((player) => {
      return boardHtml(`${player.name}'s waters`, viewBoard(player.board, false), false);
    })}`;
  } else {
    const mine = game.players[seat];
    const theirs = game.players[1 - seat];
    boards = html`${boardHtml('Your fleet', viewBoard(mine.board, true), false)}
      ${theirs === undefined
        ? ''
        : html`<form
            method="post"
            action="/games/${game.id}/fire"
            hx-post="/games/${game.id}/fire"
            hx-target="#game-panel"
            hx-swap="innerHTML"
          >
            ${boardHtml(`${theirs.name}'s waters`, viewBoard(theirs.board, false), myTurn)}
          </form>`}`;
  }

  return html`<p class="status" aria-live="polite">${statusText(game, seat)}</p>
    <p class="muted">${game.message}</p>
    ${notice === null ? '' : html`<p class="notice notice--error" role="alert">${notice}</p>`}
    ${seat === -1 && game.status === 'waiting' && viewer !== null
      ? html`<form method="post" action="/games/${game.id}/join">
          <button type="submit">Join this game</button>
        </form>`
      : ''}
    <div class="boards">${boards}</div>
    ${game.status === 'over' ? html`<p><a class="button" href="/lobby">Back to the lobby</a></p>` : ''}`;
};

export const gamePage = (
  game: Game,
  viewer: string,
  notice: string | null = null,
): SafeHtml => {
  return layoutPage(
    `Game ${game.id}`,
    viewer,
    html`<section class="card">
      <h1>Game <code>${game.id}</code></h1>
      <p class="muted">
        ${game.players.map((player) => player.name).join(' vs ')}
        · <a href="/lobby">Lobby</a>
      </p>
      <div id="game-panel" sse-connect="/games/${game.id}/events" sse-swap="panel">
        ${gamePanel(game, viewer, notice)}
      </div>
    </section>`,
  );
};

// ---------- errors ----------

export const notFoundPage = (viewer: string | null, path: string): SafeHtml => {
  return layoutPage(
    'Not found',
    viewer,
    html`<section class="card narrow">
      <h1>404: not found</h1>
      <p>There is nothing at <code>${path}</code>.</p>
      <p><a class="button" href="/lobby">Back to the lobby</a></p>
    </section>`,
  );
};

export const errorPage = (viewer: string | null, message: string): SafeHtml => {
  return layoutPage(
    'Something went wrong',
    viewer,
    html`<section class="card narrow">
      <h1>Something went wrong</h1>
      <p>${message}</p>
      <p><a class="button" href="/lobby">Back to the lobby</a></p>
    </section>`,
  );
};
