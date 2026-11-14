import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, fireAt, joinGame, type Game } from './game.js';
import {
  errorPage,
  gamePage,
  gamePanel,
  layoutPage,
  lobbyList,
  lobbyPage,
  namePage,
  notFoundPage,
} from './views.js';
import { html } from './html.js';
import { at, duel, seeded } from './testutil.js';

const count = (markup: string, pattern: RegExp): number => {
  return (markup.match(pattern) ?? []).length;
};

const waiting = (): Game => {
  return createGame('w1', 'Ana', seeded(1));
};

const playing = (): Game => {
  return joinGame(waiting(), 'Ben', seeded(2));
};

const finished = (): Game => {
  let game = fireAt(duel(), 'Ana', at(0, 0));
  game = fireAt(game, 'Ben', at(5, 5));
  return fireAt(game, 'Ana', at(0, 1));
};

describe('layoutPage', () => {
  it('wraps the body in a full document that loads HTMX and the SSE extension', () => {
    const page = layoutPage('Title', 'Ana', html`<p>body</p>`).value;
    assert.match(page, /^<!doctype html>/);
    assert.match(page, /<title>Title · Battleship<\/title>/);
    assert.match(page, /\/vendor\/htmx\/htmx\.min\.js/);
    assert.match(page, /\/vendor\/htmx-ext-sse\/sse\.min\.js/);
    assert.match(page, /<body hx-ext="sse">/);
    assert.match(page, /<p>body<\/p>/);
  });

  it('shows who is playing only when there is a viewer', () => {
    assert.match(layoutPage('T', 'Ana', html``).value, /Playing as <strong>Ana<\/strong>/);
    assert.doesNotMatch(layoutPage('T', null, html``).value, /Playing as/);
  });

  it('escapes the title and the viewer name', () => {
    const page = layoutPage('<x>', '<y>', html``).value;
    assert.ok(!page.includes('<x>'));
    assert.ok(!page.includes('<y>'));
    assert.ok(page.includes('&lt;x&gt;'));
    assert.ok(page.includes('&lt;y&gt;'));
  });

  it('configures HTMX to swap error responses in', () => {
    const page = layoutPage('T', null, html``).value;
    const match = /name="htmx-config" content="([^"]*)"/.exec(page);
    assert.ok(match);
    const config = JSON.parse(match[1].replaceAll('&quot;', '"'));
    assert.ok(config.responseHandling.some((rule: { code: string }) => rule.code === '[45]..'));
  });

  it('links stylesheets instead of using inline styles', () => {
    const page = layoutPage('T', 'Ana', html``).value;
    assert.match(page, /<link rel="stylesheet" href="\/styles\.css"/);
  });
});

describe('namePage', () => {
  it('prefills the current name and carries the next path', () => {
    const page = namePage('Ana', '/games/abc', null).value;
    assert.match(page, /name="name" value="Ana"/);
    assert.match(page, /name="next" value="\/games\/abc"/);
    assert.doesNotMatch(page, /role="alert"/);
  });

  it('shows an error when given one', () => {
    const page = namePage(null, '/lobby', 'Bad name.').value;
    assert.match(page, /role="alert">Bad name\./);
  });

  it('escapes the current name and next path inside attributes', () => {
    const page = namePage('a"b', '/x"y', null).value;
    assert.ok(page.includes('value="a&quot;b"'));
    assert.ok(page.includes('value="/x&quot;y"'));
  });
});

describe('lobbyList', () => {
  it('shows a hint when there are no games', () => {
    assert.match(lobbyList([], 'Ana').value, /No games yet/);
  });

  it('offers Open to a seated player', () => {
    const list = lobbyList([waiting()], 'Ana').value;
    assert.match(list, />Open</);
    assert.match(list, /href="\/games\/w1"/);
  });

  it('offers Join on a waiting game to a non-player', () => {
    const list = lobbyList([waiting()], 'Cy').value;
    assert.match(list, /action="\/games\/w1\/join"/);
    assert.match(list, />Join</);
    assert.match(list, /Waiting for an opponent/);
  });

  it('offers Watch on a game in progress to a spectator', () => {
    const list = lobbyList([playing()], 'Cy').value;
    assert.match(list, />Watch</);
    assert.doesNotMatch(list, />Join</);
    assert.match(list, /Ana vs Ben/);
    assert.match(list, /In progress/);
  });

  it('reports the winner of a finished game', () => {
    assert.match(lobbyList([finished()], 'Cy').value, /Finished, Ana won/);
  });

  it('lists every game and escapes player names', () => {
    const evil = createGame('e1', '<b>x</b>', seeded(1));
    const list = lobbyList([evil, playing()], 'Cy').value;
    assert.equal(count(list, /class="game-row"/g), 2);
    assert.ok(!list.includes('<b>x</b>'));
    assert.ok(list.includes('&lt;b&gt;x&lt;/b&gt;'));
  });

  it('treats a viewer-less list as a spectator', () => {
    assert.match(lobbyList([waiting()], null).value, />Join</);
  });
});

describe('lobbyPage', () => {
  it('has a create-game form and wires up the live list', () => {
    const page = lobbyPage([waiting()], 'Ben').value;
    assert.match(page, /<form method="post" action="\/games">/);
    assert.match(page, /sse-connect="\/lobby\/events"/);
    assert.match(page, /sse-swap="games"/);
    assert.match(page, /href="\/games\/w1|action="\/games\/w1\/join"/);
  });
});

describe('gamePanel', () => {
  it('lets the creator wait on their own fleet only', () => {
    const panel = gamePanel(waiting(), 'Ana').value;
    assert.match(panel, /Waiting for an opponent to join/);
    assert.equal(count(panel, /class="board-wrap"/g), 1);
    assert.match(panel, /Your fleet/);
    assert.equal(count(panel, /cell--fireable/g), 0);
    assert.doesNotMatch(panel, /Join this game/);
  });

  it('offers spectators a join button on a waiting game, but not a viewer-less visitor', () => {
    assert.match(gamePanel(waiting(), 'Cy').value, /Join this game/);
    assert.doesNotMatch(gamePanel(waiting(), null).value, /Join this game/);
  });

  it('makes every untouched enemy cell fireable on your turn', () => {
    const panel = gamePanel(playing(), 'Ana').value;
    assert.match(panel, /Your turn: pick a cell to fire at\./);
    assert.equal(count(panel, /cell--fireable/g), 100);
    assert.match(panel, /aria-label="Fire at A1"/);
    assert.match(panel, /value="9,9"/);
  });

  it('makes nothing fireable when it is the other player\'s turn', () => {
    const panel = gamePanel(playing(), 'Ben').value;
    assert.match(panel, /Waiting for Ana to fire/);
    assert.equal(count(panel, /cell--fireable/g), 0);
  });

  it('removes a cell from the fireable set once it has been shot', () => {
    // Ana shoots, Ben shoots back; now it is Ana's turn again with one cell used.
    let game = fireAt(playing(), 'Ana', at(0, 0));
    game = fireAt(game, 'Ben', at(5, 5));
    const panel = gamePanel(game, 'Ana').value;
    assert.equal(count(panel, /cell--fireable/g), 99);
    assert.ok(!panel.includes('value="0,0"'));
  });

  it('shows a spectator both boards, no ships, and no controls', () => {
    const panel = gamePanel(playing(), 'Cy').value;
    assert.equal(count(panel, /class="board-wrap"/g), 2);
    assert.match(panel, /Ana&#39;s turn\./);
    assert.equal(count(panel, /cell--ship/g), 0);
    assert.equal(count(panel, /cell--fireable/g), 0);
    assert.doesNotMatch(panel, /<form/);
  });

  it('shows the owner all 17 of their own ship cells and none of the opponent\'s', () => {
    const panel = gamePanel(playing(), 'Ana').value;
    assert.equal(count(panel, /cell--ship/g), 17);
  });

  it('reveals a sunk ship on the enemy board', () => {
    const game = finished();
    const panel = gamePanel(game, 'Ana').value;
    assert.equal(count(panel, /cell--sunk/g), 2);
  });

  it('shows the winner and a way back once the game is over, with nothing fireable', () => {
    for (const viewer of ['Ana', 'Ben', 'Cy', null]) {
      const panel = gamePanel(finished(), viewer).value;
      assert.match(panel, /Ana wins!/);
      assert.match(panel, /Back to the lobby/);
      assert.equal(count(panel, /cell--fireable/g), 0);
    }
  });

  it('shows the latest message', () => {
    const game = fireAt(playing(), 'Ana', at(0, 0));
    assert.ok(gamePanel(game, 'Ben').value.includes(game.message));
  });

  it('renders and escapes an error notice', () => {
    const panel = gamePanel(playing(), 'Ana', '<script>bad</script>').value;
    assert.match(panel, /class="notice notice--error" role="alert"/);
    assert.ok(!panel.includes('<script>'));
    assert.ok(panel.includes('&lt;script&gt;'));
    assert.doesNotMatch(gamePanel(playing(), 'Ana').value, /role="alert"/);
  });

  it('posts shots both as a plain form and through HTMX', () => {
    const panel = gamePanel(playing(), 'Ana').value;
    assert.match(panel, /method="post"/);
    assert.match(panel, /action="\/games\/[^"]+\/fire"/);
    assert.match(panel, /hx-post="\/games\/[^"]+\/fire"/);
    assert.match(panel, /hx-target="#game-panel"/);
  });

  it('gives every cell an accessible label', () => {
    const panel = gamePanel(playing(), 'Cy').value;
    assert.equal(count(panel, /role="img"/g), count(panel, /aria-label="[A-J]\d+: /g));
  });

  it('labels the board with columns A to J and rows 1 to 10', () => {
    const panel = gamePanel(playing(), 'Ana').value;
    for (const letter of 'ABCDEFGHIJ') {
      assert.match(panel, new RegExp(`<span class="board__label">${letter}</span>`));
    }
    assert.match(panel, /<span class="board__label">10<\/span>/);
  });
});

describe('gamePage', () => {
  it('embeds the panel and subscribes to the game events', () => {
    const page = gamePage(playing(), 'Ana').value;
    assert.match(page, /id="game-panel"/);
    assert.match(page, /sse-connect="\/games\/w1\/events"/);
    assert.match(page, /sse-swap="panel"/);
    assert.match(page, /Ana vs Ben/);
  });

  it('passes a notice through to the panel', () => {
    assert.match(gamePage(playing(), 'Ana', 'Nope.').value, /role="alert">Nope\./);
  });
});

describe('error pages', () => {
  it('escapes the missing path on the 404 page', () => {
    const page = notFoundPage('Ana', '/<script>').value;
    assert.match(page, /404/);
    assert.ok(!page.includes('<script>'));
  });

  it('escapes the message on the error page', () => {
    const page = errorPage(null, '<b>oops</b>').value;
    assert.match(page, /Something went wrong/);
    assert.ok(!page.includes('<b>oops</b>'));
  });
});

describe('no inline styles anywhere', () => {
  it('uses classes, never style tags or attributes', () => {
    const pages = [
      namePage('Ana', '/lobby', 'err').value,
      lobbyPage([waiting(), playing(), finished()], 'Ana').value,
      gamePage(playing(), 'Ana', 'note').value,
      gamePage(finished(), 'Cy').value,
      notFoundPage(null, '/x').value,
      errorPage(null, 'm').value,
    ];
    for (const page of pages) {
      assert.doesNotMatch(page, /<style/i);
      assert.doesNotMatch(page, /\sstyle=/i);
    }
  });
});
