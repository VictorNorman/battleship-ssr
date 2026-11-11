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
    const page = await (await request('/lobby', { name })).text();
    assert.ok(!page.includes('<img src=x on=1>'));
    assert.ok(page.includes('&lt;img src=x on=1&gt;'));
  });
});

describe('server-side rendering', () => {
  it('puts the games in the initial lobby HTML', async () => {
    const id = await createGameAs('Ana');
    const page = await (await request('/lobby', { name: 'Ben' })).text();
    assert.ok(page.includes(`/games/${id}/join`));
  });

  it('shows a player only their own ships, and a spectator none', async () => {
    const id = await startGame();
    const ana = await (await request(`/games/${id}`, { name: 'Ana' })).text();
    const ben = await (await request(`/games/${id}`, { name: 'Ben' })).text();
    const cy = await (await request(`/games/${id}`, { name: 'Cy' })).text();
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
