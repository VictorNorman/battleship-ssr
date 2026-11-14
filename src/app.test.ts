import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from './app.js';
import { connectionCount } from './hub.js';
import { clearGames, getGame } from './store.js';

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  clearGames();
});

interface Options {
  name?: string;
  method?: string;
  form?: Record<string, string>;
  htmx?: boolean;
}

const request = async (path: string, options: Options = {}): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (options.name !== undefined) {
    headers.Cookie = `player=${encodeURIComponent(options.name)}`;
  }
  if (options.htmx) {
    headers['HX-Request'] = 'true';
  }
  let body: string | undefined;
  if (options.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(options.form).toString();
  }
  return fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    redirect: 'manual',
  });
};

const get = (path: string, name: string): Promise<Response> => {
  return request(path, {
    name,
  });
};

const createGameAs = async (name: string): Promise<string> => {
  const response = await request('/games', {
    name,
    method: 'POST',
  });
  assert.equal(response.status, 303);
  return (response.headers.get('location') as string).split('/').pop() as string;
};

const startGame = async (): Promise<string> => {
  const id = await createGameAs('Ana');
  const joined = await request(`/games/${id}/join`, {
    name: 'Ben',
    method: 'POST',
  });
  assert.equal(joined.status, 303);
  return id;
};

const countShipCells = (markup: string): number => {
  return (markup.match(/cell--ship/g) ?? []).length;
};

// Minimal SSE client built on fetch streaming.
const openStream = async (path: string, name: string) => {
  const controller = new AbortController();
  const response = await fetch(`${base}${path}`, {
    headers: {
      Cookie: `player=${encodeURIComponent(name)}`,
    },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: string[] = [];

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() as string;
        for (const part of parts) {
          if (part.includes('event: ')) {
            events.push(part);
          }
        }
      }
    } catch {
      // Aborted by close().
    }
  })();

  const waitForEvents = async (count: number): Promise<void> => {
    for (let i = 0; i < 100 && events.length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(events.length >= count, `expected ${count} events, got ${events.length}`);
  };

  return {
    events,
    waitForEvents,
    close: () => controller.abort(),
  };
};

describe('identity and routing', () => {
  it('redirects pages to the name form when no name is set', async () => {
    const response = await request('/lobby');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/?next=%2Flobby');
  });

  it('sets the cookie and redirects after choosing a name', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {
        name: 'Ana',
        next: '/games/abc',
      },
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/games/abc');
    assert.match(response.headers.get('set-cookie') ?? '', /^player=Ana;/);
  });

  it('ignores off-site redirect targets', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {
        name: 'Ana',
        next: '//evil.example',
      },
    });
    assert.equal(response.headers.get('location'), '/lobby');
  });

  it('rejects an empty name', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {
        name: '   ',
      },
    });
    assert.equal(response.status, 400);
  });

  it('serves a 404 page for unknown routes and games', async () => {
    const unknown = await request('/nope', {
      name: 'Ana',
    });
    assert.equal(unknown.status, 404);
    const game = await request('/games/deadbeef', {
      name: 'Ana',
    });
    assert.equal(game.status, 404);
    assert.match(await game.text(), /404/);
  });

  it('escapes display names in rendered pages', async () => {
    const name = '<img src=x on=1>';
    await createGameAs(name);
    const page = await (await get('/lobby', name)).text();
    assert.ok(!page.includes('<img src=x on=1>'));
    assert.ok(page.includes('&lt;img src=x on=1&gt;'));
  });
});

describe('server-side rendering', () => {
  it('puts the games in the initial lobby HTML', async () => {
    const id = await createGameAs('Ana');
    const page = await (await get('/lobby', 'Ben')).text();
    assert.ok(page.includes(`/games/${id}/join`));
  });

  it('shows a player only their own ships, and a spectator none', async () => {
    const id = await startGame();
    const ana = await (await get(`/games/${id}`, 'Ana')).text();
    const ben = await (await get(`/games/${id}`, 'Ben')).text();
    const cy = await (await get(`/games/${id}`, 'Cy')).text();
    assert.equal(countShipCells(ana), 17);
    assert.equal(countShipCells(ben), 17);
    assert.equal(countShipCells(cy), 0);
  });
});

describe('playing a game', () => {
  it('returns just the panel fragment to HTMX and updates state', async () => {
    const id = await startGame();
    const response = await request(`/games/${id}/fire`, {
      name: 'Ana',
      method: 'POST',
      form: {
        cell: '0,0',
      },
      htmx: true,
    });
    assert.equal(response.status, 200);
    const fragment = await response.text();
    assert.ok(!fragment.includes('<html'));
    assert.match(fragment, /Waiting for Ben/);
    assert.equal(getGame(id)?.turn, 1);
  });

  it('redirects a plain form post (Post/Redirect/Get)', async () => {
    const id = await startGame();
    const response = await request(`/games/${id}/fire`, {
      name: 'Ana',
      method: 'POST',
      form: {
        cell: '0,0',
      },
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/games/${id}`);
  });

  it('rejects moves out of turn, by spectators, and malformed cells', async () => {
    const id = await startGame();
    const fire = (name: string, cell: string) => {
      return request(`/games/${id}/fire`, {
        name,
        method: 'POST',
        form: {
          cell,
        },
        htmx: true,
      });
    };
    const outOfTurn = await fire('Ben', '0,0');
    assert.equal(outOfTurn.status, 409);
    assert.match(await outOfTurn.text(), /not your turn/);
    assert.equal((await fire('Cy', '0,0')).status, 403);
    assert.equal((await fire('Ana', '99,99')).status, 400);
    assert.equal((await fire('Ana', 'banana')).status, 400);
    assert.equal(getGame(id)?.players[1].board.shots.length, 0);
  });

  it('refuses a third player', async () => {
    const id = await startGame();
    const response = await request(`/games/${id}/join`, {
      name: 'Cy',
      method: 'POST',
      htmx: true,
    });
    assert.equal(response.status, 409);
  });
});

describe('server-sent events', () => {
  it('requires a name', async () => {
    const id = await startGame();
    const response = await request(`/games/${id}/events`);
    assert.equal(response.status, 401);
  });

  it('pushes role-specific HTML and never leaks ships', async () => {
    const id = await startGame();
    const ana = await openStream(`/games/${id}/events`, 'Ana');
    const ben = await openStream(`/games/${id}/events`, 'Ben');
    const cy = await openStream(`/games/${id}/events`, 'Cy');
    try {
      // Each connection gets an initial snapshot.
      await Promise.all([ana.waitForEvents(1), ben.waitForEvents(1), cy.waitForEvents(1)]);

      const shipCell = getGame(id)?.players[1].board.ships[0].cells[0];
      const fired = await request(`/games/${id}/fire`, {
        name: 'Ana',
        method: 'POST',
        form: {
          cell: `${shipCell?.row},${shipCell?.col}`,
        },
        htmx: true,
      });
      assert.equal(fired.status, 200);

      await Promise.all([ana.waitForEvents(2), ben.waitForEvents(2), cy.waitForEvents(2)]);

      const last = (stream: { events: string[] }) => stream.events[stream.events.length - 1];
      assert.match(last(ana), /fired at/);
      assert.match(last(ben), /Your turn/);
      assert.equal(countShipCells(last(ana)), 17);
      assert.equal(countShipCells(last(ben)), 16);
      assert.equal(countShipCells(last(cy)), 0);
      assert.match(last(ana), /event: panel/);
      assert.match(last(ana), /id: 3/);
    } finally {
      ana.close();
      ben.close();
      cy.close();
    }
  });

  it('removes closed connections', async () => {
    const id = await startGame();
    const stream = await openStream(`/games/${id}/events`, 'Ana');
    await stream.waitForEvents(1);
    assert.equal(connectionCount(`game:${id}`), 1);
    stream.close();
    for (let i = 0; i < 100 && connectionCount(`game:${id}`) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(connectionCount(`game:${id}`), 0);
  });

  it('pushes new games to the lobby stream', async () => {
    const lobby = await openStream('/lobby/events', 'Ben');
    try {
      await lobby.waitForEvents(1);
      await createGameAs('Ana');
      await lobby.waitForEvents(2);
      assert.match(lobby.events[1], /Ana/);
    } finally {
      lobby.close();
    }
  });
});

const formFor = (cell: string | undefined): Record<string, string> => {
  if (cell === undefined) {
    return {};
  }
  return {
    cell,
  };
};

const fireCell = (id: string, name: string, cell: string | undefined, htmx = true) => {
  return request(`/games/${id}/fire`, {
    name,
    method: 'POST',
    form: formFor(cell),
    htmx,
  });
};

const countMatches = (markup: string, pattern: RegExp): number => {
  return (markup.match(pattern) ?? []).length;
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe('name form', () => {
  it('prefills the current name and carries a safe next path', async () => {
    const page = await (
      await request('/?next=%2Fgames%2Fabc', {
        name: 'Ana',
      })
    ).text();
    assert.match(page, /name="name" value="Ana"/);
    assert.match(page, /name="next" value="\/games\/abc"/);
  });

  it('replaces an off-site next path with the lobby', async () => {
    const page = await (await request('/?next=//evil.example')).text();
    assert.match(page, /name="next" value="\/lobby"/);
  });

  it('escapes quotes in the next path', async () => {
    const page = await (await request('/?next=%2Fa%22b')).text();
    assert.ok(page.includes('value="/a&quot;b"'));
  });

  it('cleans up whitespace in the chosen name', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {
        name: '  Ana   Smith ',
      },
    });
    assert.match(response.headers.get('set-cookie') ?? '', /^player=Ana%20Smith;/);
    assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
    assert.match(response.headers.get('set-cookie') ?? '', /Path=\//);
  });

  it('rejects a name that is too long and re-shows the form with an error', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {
        name: 'x'.repeat(25),
        next: '/games/abc',
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    const page = await response.text();
    assert.match(page, /1 to 24 characters/);
    assert.match(page, /name="next" value="\/games\/abc"/);
  });

  it('rejects a missing name field', async () => {
    const response = await request('/name', {
      method: 'POST',
      form: {},
    });
    assert.equal(response.status, 400);
  });

  it('treats a cookie with a malformed encoding as no name', async () => {
    const response = await fetch(`${base}/lobby`, {
      headers: {
        Cookie: 'player=%E0%A4%A',
      },
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
  });

  it('remembers the original destination through the name form', async () => {
    const id = await createGameAs('Ana');
    const response = await request(`/games/${id}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/?next=%2Fgames%2F${id}`);
  });
});

describe('lobby', () => {
  it('says there are no games when empty', async () => {
    const page = await (await get('/lobby', 'Ana')).text();
    assert.match(page, /No games yet/);
  });

  it('requires a name to create a game, and creates nothing without one', async () => {
    const response = await request('/games', {
      method: 'POST',
    });
    assert.equal(response.status, 302);
    const page = await (await get('/lobby', 'Ana')).text();
    assert.match(page, /No games yet/);
  });

  it('creates a game with the creator in seat 0, waiting', async () => {
    const id = await createGameAs('Ana');
    const game = getGame(id);
    assert.equal(game?.status, 'waiting');
    assert.equal(game?.creator, 'Ana');
    assert.match(id, /^[0-9a-f]{8}$/);
  });

  it('shows Open to the creator, Join to others, and Watch once it is full', async () => {
    const id = await createGameAs('Ana');
    const ana = await (await get('/lobby', 'Ana')).text();
    const cy = await (await get('/lobby', 'Cy')).text();
    assert.match(ana, />Open</);
    assert.match(cy, />Join</);

    await request(`/games/${id}/join`, {
      name: 'Ben',
      method: 'POST',
    });
    const cyAfter = await (await get('/lobby', 'Cy')).text();
    assert.match(cyAfter, />Watch</);
    assert.doesNotMatch(cyAfter, />Join</);
    assert.match(cyAfter, /Ana vs Ben/);
  });

  it('lists the newest game first', async () => {
    const first = await createGameAs('Ana');
    await sleep(5);
    const second = await createGameAs('Ben');
    const page = await (await get('/lobby', 'Cy')).text();
    assert.ok(page.indexOf(second) < page.indexOf(first));
  });
});

describe('joining', () => {
  it('lets a second player join and starts the game', async () => {
    const id = await createGameAs('Ana');
    const response = await request(`/games/${id}/join`, {
      name: 'Ben',
      method: 'POST',
      htmx: true,
    });
    assert.equal(response.status, 200);
    assert.equal(getGame(id)?.status, 'playing');
    assert.match(await response.text(), /Waiting for Ana to fire/);
  });

  it('treats the creator joining their own game as a harmless repeat', async () => {
    const id = await createGameAs('Ana');
    const response = await request(`/games/${id}/join`, {
      name: 'Ana',
      method: 'POST',
    });
    assert.equal(response.status, 303);
    assert.equal(getGame(id)?.status, 'waiting');
    assert.equal(getGame(id)?.version, 1);
  });

  it('returns the full page with a 409 to a plain-form third player', async () => {
    const id = await startGame();
    const response = await request(`/games/${id}/join`, {
      name: 'Cy',
      method: 'POST',
    });
    assert.equal(response.status, 409);
    const page = await response.text();
    assert.match(page, /<html/);
    assert.match(page, /already has two players/);
  });

  it('returns 404 for an unknown game', async () => {
    const response = await request('/games/nope/join', {
      name: 'Ana',
      method: 'POST',
    });
    assert.equal(response.status, 404);
  });

  it('requires a name', async () => {
    const id = await createGameAs('Ana');
    const response = await request(`/games/${id}/join`, {
      method: 'POST',
    });
    assert.equal(response.status, 302);
    assert.equal(getGame(id)?.status, 'waiting');
  });
});

describe('game page rendering', () => {
  it('gives a player 100 fireable cells on their turn and none otherwise', async () => {
    const id = await startGame();
    const ana = await (await get(`/games/${id}`, 'Ana')).text();
    const ben = await (await get(`/games/${id}`, 'Ben')).text();
    assert.equal(countMatches(ana, /cell--fireable/g), 100);
    assert.equal(countMatches(ben, /cell--fireable/g), 0);
  });

  it('gives spectators no controls on a game in progress', async () => {
    const id = await startGame();
    const cy = await (await get(`/games/${id}`, 'Cy')).text();
    assert.equal(countMatches(cy, /cell--fireable/g), 0);
    assert.doesNotMatch(cy, /\/fire"/);
  });

  it('offers spectators a join button on a waiting game', async () => {
    const id = await createGameAs('Ana');
    const cy = await (await get(`/games/${id}`, 'Cy')).text();
    assert.match(cy, /Join this game/);
    const ana = await (await get(`/games/${id}`, 'Ana')).text();
    assert.doesNotMatch(ana, /Join this game/);
  });

  it('wires the page to its own event stream', async () => {
    const id = await startGame();
    const page = await (await get(`/games/${id}`, 'Ana')).text();
    assert.ok(page.includes(`sse-connect="/games/${id}/events"`));
  });

  it('escapes player names on the game page', async () => {
    const id = await createGameAs('<i>x</i>');
    const page = await (await get(`/games/${id}`, '<i>x</i>')).text();
    assert.ok(!page.includes('<i>x</i>'));
    assert.ok(page.includes('&lt;i&gt;x&lt;/i&gt;'));
  });

  it('never uses inline styles', async () => {
    const id = await startGame();
    for (const path of ['/', '/lobby', `/games/${id}`, '/nope']) {
      const page = await (await get(path, 'Ana')).text();
      assert.doesNotMatch(page, /<style/i, path);
      assert.doesNotMatch(page, /\sstyle=/i, path);
    }
  });
});

describe('firing', () => {
  it('rejects malformed cells with a 400 and changes nothing', async () => {
    const id = await startGame();
    for (const cell of ['', '1', '1,', ',1', '1,2,3', 'a,b', '-1,0', '1.5,2', '1, 2', '100,0', '10,10']) {
      const response = await fireCell(id, 'Ana', cell);
      assert.equal(response.status, 400, `cell ${JSON.stringify(cell)}`);
    }
    const missing = await fireCell(id, 'Ana', undefined);
    assert.equal(missing.status, 400);
    assert.equal(getGame(id)?.version, 2);
    assert.equal(getGame(id)?.turn, 0);
  });

  it('shows the error inside the panel fragment for HTMX', async () => {
    const id = await startGame();
    const response = await fireCell(id, 'Ana', 'banana');
    const fragment = await response.text();
    assert.match(fragment, /role="alert"/);
    assert.match(fragment, /Choose a cell on the board/);
    assert.ok(!fragment.includes('<html'));
  });

  it('returns the full page with the error for a plain form post', async () => {
    const id = await startGame();
    const response = await fireCell(id, 'Ben', '0,0', false);
    assert.equal(response.status, 409);
    const page = await response.text();
    assert.match(page, /<html/);
    assert.match(page, /not your turn/);
  });

  it('rejects firing before an opponent has joined', async () => {
    const id = await createGameAs('Ana');
    const response = await fireCell(id, 'Ana', '0,0');
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Waiting for an opponent/);
  });

  it('rejects a repeat shot at the same cell', async () => {
    const id = await startGame();
    assert.equal((await fireCell(id, 'Ana', '4,4')).status, 200);
    assert.equal((await fireCell(id, 'Ben', '4,4')).status, 200);
    const again = await fireCell(id, 'Ana', '4,4');
    assert.equal(again.status, 409);
    assert.match(await again.text(), /already fired at E5/);
    assert.equal(getGame(id)?.turn, 0);
  });

  it('returns 404 for an unknown game and redirects without a name', async () => {
    assert.equal((await fireCell('nope', 'Ana', '0,0')).status, 404);
    const id = await startGame();
    const anonymous = await request(`/games/${id}/fire`, {
      method: 'POST',
      form: {
        cell: '0,0',
      },
    });
    assert.equal(anonymous.status, 302);
    assert.equal(getGame(id)?.version, 2);
  });

  it('updates the fireable count after a shot', async () => {
    const id = await startGame();
    await fireCell(id, 'Ana', '0,0');
    await fireCell(id, 'Ben', '0,0');
    const ana = await (await get(`/games/${id}`, 'Ana')).text();
    assert.equal(countMatches(ana, /cell--fireable/g), 99);
  });

  it('plays a whole game to the end over HTTP', async () => {
    const id = await startGame();
    const target = getGame(id)?.players[1].board.ships.flatMap((ship) => ship.cells) ?? [];
    assert.equal(target.length, 17);

    // Ben fires at the first 16 cells in reading order; that can never win.
    const benCells: string[] = [];
    for (let row = 0; row < 10 && benCells.length < 16; row++) {
      for (let col = 0; col < 10 && benCells.length < 16; col++) {
        benCells.push(`${row},${col}`);
      }
    }

    for (let i = 0; i < target.length; i++) {
      const hit = await fireCell(id, 'Ana', `${target[i].row},${target[i].col}`);
      assert.equal(hit.status, 200);
      if (i < target.length - 1) {
        assert.equal((await fireCell(id, 'Ben', benCells[i])).status, 200);
      }
    }

    const game = getGame(id);
    assert.equal(game?.status, 'over');
    assert.equal(game?.winner, 'Ana');

    const ben = await (await get(`/games/${id}`, 'Ben')).text();
    assert.match(ben, /Ana wins!/);
    assert.match(ben, /Back to the lobby/);
    assert.equal(countMatches(ben, /cell--fireable/g), 0);

    const late = await fireCell(id, 'Ben', '9,9');
    assert.equal(late.status, 409);
    assert.match(await late.text(), /The game is over/);

    const lobby = await (await get('/lobby', 'Cy')).text();
    assert.match(lobby, /Finished, Ana won/);
  });
});

describe('static files and errors', () => {
  it('serves the stylesheet and the vendored HTMX scripts', async () => {
    const css = await request('/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    for (const path of ['/vendor/htmx/htmx.min.js', '/vendor/htmx-ext-sse/sse.min.js']) {
      const script = await request(path);
      assert.equal(script.status, 200, path);
      assert.match(script.headers.get('content-type') ?? '', /javascript/, path);
    }
  });

  it('does not advertise Express', async () => {
    const response = await request('/');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('returns 404 for unsupported methods on known paths', async () => {
    const response = await request('/lobby', {
      name: 'Ana',
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });

  it('escapes the path on the 404 page', async () => {
    const response = await request('/%3Cscript%3Ealert(1)%3C/script%3E', {
      name: 'Ana',
    });
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /<script>alert/);
  });
});

describe('server-sent events, more', () => {
  it('rejects a lobby stream without a name', async () => {
    const response = await request('/lobby/events');
    assert.equal(response.status, 401);
  });

  it('returns 404 for the event stream of an unknown game', async () => {
    const response = await request('/games/nope/events', {
      name: 'Ana',
    });
    assert.equal(response.status, 404);
  });

  it('frames events as id, event, and data lines ending with a blank line', async () => {
    const id = await startGame();
    const stream = await openStream(`/games/${id}/events`, 'Ana');
    try {
      await stream.waitForEvents(1);
      const lines = stream.events[0].split('\n');
      assert.equal(lines[0], `id: ${getGame(id)?.version}`);
      assert.equal(lines[1], 'event: panel');
      assert.ok(lines.slice(2).every((line) => line.startsWith('data: ') || line === 'data:'));
    } finally {
      stream.close();
    }
  });

  it('sends each viewer a snapshot of their own view on connect', async () => {
    const id = await startGame();
    const ana = await openStream(`/games/${id}/events`, 'Ana');
    const cy = await openStream(`/games/${id}/events`, 'Cy');
    try {
      await Promise.all([ana.waitForEvents(1), cy.waitForEvents(1)]);
      assert.equal(countMatches(ana.events[0], /cell--ship/g), 17);
      assert.equal(countMatches(cy.events[0], /cell--ship/g), 0);
    } finally {
      ana.close();
      cy.close();
    }
  });

  it('sends no event for a rejected move', async () => {
    const id = await startGame();
    const stream = await openStream(`/games/${id}/events`, 'Ana');
    try {
      await stream.waitForEvents(1);
      await fireCell(id, 'Ben', '0,0');
      await fireCell(id, 'Ana', 'banana');
      await sleep(150);
      assert.equal(stream.events.length, 1);
    } finally {
      stream.close();
    }
  });

  it('advances the event id with every move', async () => {
    const id = await startGame();
    const stream = await openStream(`/games/${id}/events`, 'Cy');
    try {
      await stream.waitForEvents(1);
      await fireCell(id, 'Ana', '0,0');
      await fireCell(id, 'Ben', '0,0');
      await stream.waitForEvents(3);
      const ids = stream.events.map((event) => /^id: (\d+)/m.exec(event)?.[1]);
      assert.deepEqual(ids, ['2', '3', '4']);
    } finally {
      stream.close();
    }
  });

  it('streams the creator an update when an opponent joins', async () => {
    const id = await createGameAs('Ana');
    const stream = await openStream(`/games/${id}/events`, 'Ana');
    try {
      await stream.waitForEvents(1);
      assert.match(stream.events[0], /Waiting for an opponent/);
      await request(`/games/${id}/join`, {
        name: 'Ben',
        method: 'POST',
      });
      await stream.waitForEvents(2);
      assert.match(stream.events[1], /Your turn/);
    } finally {
      stream.close();
    }
  });

  it('streams a join to the lobby', async () => {
    const id = await createGameAs('Ana');
    const lobby = await openStream('/lobby/events', 'Cy');
    try {
      await lobby.waitForEvents(1);
      assert.match(lobby.events[0], />Join</);
      await request(`/games/${id}/join`, {
        name: 'Ben',
        method: 'POST',
      });
      await lobby.waitForEvents(2);
      assert.match(lobby.events[1], /Ana vs Ben/);
      assert.match(lobby.events[1], />Watch</);
    } finally {
      lobby.close();
    }
  });

  it('keeps ordinary shots off the lobby stream but announces the finish', async () => {
    const id = await startGame();
    const lobby = await openStream('/lobby/events', 'Cy');
    try {
      await lobby.waitForEvents(1);
      await fireCell(id, 'Ana', '0,0');
      await sleep(150);
      assert.equal(lobby.events.length, 1);

      // Finish the game quickly by rewriting the stored game to a nearly-won state.
      const game = getGame(id);
      assert.ok(game);
      const ships = game.players[1].board.ships;
      const remaining = ships.flatMap((ship) => ship.cells);
      const last = remaining[remaining.length - 1];
      const shots = remaining.filter((cell) => cell !== last);
      const nearlyWon = {
        ...game,
        turn: 0,
        players: [
          game.players[0],
          {
            ...game.players[1],
            board: {
              ...game.players[1].board,
              shots,
            },
          },
        ],
      };
      const { saveGame } = await import('./store.js');
      saveGame(nearlyWon);
      const response = await fireCell(id, 'Ana', `${last.row},${last.col}`);
      assert.equal(response.status, 200);
      await lobby.waitForEvents(2);
      assert.match(lobby.events[1], /Finished, Ana won/);
    } finally {
      lobby.close();
    }
  });

  it('serves several spectators and removes each when it disconnects', async () => {
    const id = await startGame();
    const streams = await Promise.all([
      openStream(`/games/${id}/events`, 'Cy'),
      openStream(`/games/${id}/events`, 'Di'),
      openStream(`/games/${id}/events`, 'Ed'),
    ]);
    try {
      await Promise.all(streams.map((stream) => stream.waitForEvents(1)));
      assert.equal(connectionCount(`game:${id}`), 3);
      streams[0].close();
      for (let i = 0; i < 100 && connectionCount(`game:${id}`) > 2; i++) {
        await sleep(20);
      }
      assert.equal(connectionCount(`game:${id}`), 2);
    } finally {
      streams.forEach((stream) => stream.close());
    }
  });
});
