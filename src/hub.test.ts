import assert from 'node:assert/strict';
import type { Response } from 'express';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { connectionCount, publish, subscribe } from './hub.js';

// Just enough of an Express response to drive the hub.
const fakeResponse = () => {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  let flushed = false;
  const res = Object.assign(emitter, {
    set: (values: Record<string, string>) => {
      Object.assign(headers, values);
    },
    flushHeaders: () => {
      flushed = true;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  });
  return {
    res: res as unknown as Response,
    chunks,
    headers,
    isFlushed: () => flushed,
    close: () => {
      emitter.emit('close');
    },
  };
};

let counter = 0;
const uniqueChannel = (): string => {
  counter += 1;
  return `test-channel-${counter}`;
};

describe('hub', () => {
  it('sets SSE headers and flushes them', () => {
    const channel = uniqueChannel();
    const client = fakeResponse();
    subscribe(channel, client.res, {
      viewer: 'Ana',
      event: 'panel',
      render: () => 'x',
    });
    try {
      assert.equal(client.headers['Content-Type'], 'text/event-stream');
      assert.match(client.headers['Cache-Control'], /no-cache/);
      assert.ok(client.isFlushed());
    } finally {
      client.close();
    }
  });

  it('sends an immediate snapshot, with the id when given', () => {
    const channel = uniqueChannel();
    const client = fakeResponse();
    subscribe(
      channel,
      client.res,
      {
        viewer: 'Ana',
        event: 'panel',
        render: (viewer) => `hello ${viewer}`,
      },
      7,
    );
    try {
      assert.deepEqual(client.chunks, ['id: 7\nevent: panel\ndata: hello Ana\n\n']);
    } finally {
      client.close();
    }
  });

  it('omits the id line when there is no version', () => {
    const channel = uniqueChannel();
    const client = fakeResponse();
    subscribe(channel, client.res, {
      viewer: null,
      event: 'games',
      render: () => 'list',
    });
    try {
      assert.deepEqual(client.chunks, ['event: games\ndata: list\n\n']);
    } finally {
      client.close();
    }
  });

  it('prefixes every line of multi-line HTML with data:', () => {
    const channel = uniqueChannel();
    const client = fakeResponse();
    subscribe(channel, client.res, {
      viewer: null,
      event: 'panel',
      render: () => '<div>\n  <p>hi</p>\n</div>',
    });
    try {
      assert.equal(
        client.chunks[0],
        'event: panel\ndata: <div>\ndata:   <p>hi</p>\ndata: </div>\n\n',
      );
    } finally {
      client.close();
    }
  });

  it('renders separately for each viewer on publish', () => {
    const channel = uniqueChannel();
    const ana = fakeResponse();
    const cy = fakeResponse();
    const render = (viewer: string | null) => `for ${viewer}`;
    subscribe(channel, ana.res, {
      viewer: 'Ana',
      event: 'panel',
      render,
    });
    subscribe(channel, cy.res, {
      viewer: 'Cy',
      event: 'panel',
      render,
    });
    try {
      publish(channel, 3);
      assert.equal(ana.chunks[1], 'id: 3\nevent: panel\ndata: for Ana\n\n');
      assert.equal(cy.chunks[1], 'id: 3\nevent: panel\ndata: for Cy\n\n');
    } finally {
      ana.close();
      cy.close();
    }
  });

  it('only publishes to the named channel', () => {
    const one = uniqueChannel();
    const two = uniqueChannel();
    const a = fakeResponse();
    const b = fakeResponse();
    subscribe(one, a.res, {
      viewer: null,
      event: 'e',
      render: () => 'a',
    });
    subscribe(two, b.res, {
      viewer: null,
      event: 'e',
      render: () => 'b',
    });
    try {
      publish(one);
      assert.equal(a.chunks.length, 2);
      assert.equal(b.chunks.length, 1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('ignores a publish to a channel nobody listens to', () => {
    assert.doesNotThrow(() => {
      publish(uniqueChannel());
    });
  });

  it('counts connections and forgets closed ones', () => {
    const channel = uniqueChannel();
    assert.equal(connectionCount(channel), 0);
    const a = fakeResponse();
    const b = fakeResponse();
    const client = {
      viewer: null,
      event: 'e',
      render: () => 'x',
    };
    subscribe(channel, a.res, client);
    subscribe(channel, b.res, client);
    assert.equal(connectionCount(channel), 2);
    a.close();
    assert.equal(connectionCount(channel), 1);
    b.close();
    assert.equal(connectionCount(channel), 0);
  });

  it('stops writing to a closed connection', () => {
    const channel = uniqueChannel();
    const stays = fakeResponse();
    const leaves = fakeResponse();
    const client = {
      viewer: null,
      event: 'e',
      render: () => 'x',
    };
    subscribe(channel, stays.res, client);
    subscribe(channel, leaves.res, client);
    try {
      leaves.close();
      publish(channel);
      assert.equal(leaves.chunks.length, 1);
      assert.equal(stays.chunks.length, 2);
    } finally {
      stays.close();
    }
  });
});
