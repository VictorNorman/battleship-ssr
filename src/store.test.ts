import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createGame, type Game } from './game.js';
import { clearGames, getGame, listGames, newGameId, saveGame } from './store.js';
import { seeded } from './testutil.js';

const gameAt = (id: string, createdAt: number): Game => {
  return {
    ...createGame(id, 'Ana', seeded(1)),
    createdAt,
  };
};

beforeEach(() => {
  clearGames();
});

describe('newGameId', () => {
  it('is 8 lowercase hex characters', () => {
    assert.match(newGameId(), /^[0-9a-f]{8}$/);
  });

  it('does not repeat across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      ids.add(newGameId());
    }
    assert.equal(ids.size, 500);
  });
});

describe('store', () => {
  it('returns undefined for an unknown id', () => {
    assert.equal(getGame('nope'), undefined);
  });

  it('saves and retrieves a game', () => {
    const game = gameAt('a', 1);
    saveGame(game);
    assert.equal(getGame('a'), game);
  });

  it('replaces a game saved under the same id', () => {
    saveGame(gameAt('a', 1));
    const newer = {
      ...gameAt('a', 1),
      version: 5,
    };
    saveGame(newer);
    assert.equal(getGame('a')?.version, 5);
    assert.equal(listGames().length, 1);
  });

  it('lists newest first', () => {
    saveGame(gameAt('old', 100));
    saveGame(gameAt('new', 300));
    saveGame(gameAt('mid', 200));
    assert.deepEqual(
      listGames().map((game) => game.id),
      ['new', 'mid', 'old'],
    );
  });

  it('honors the limit and defaults to 20', () => {
    for (let i = 0; i < 25; i++) {
      saveGame(gameAt(`g${i}`, i));
    }
    assert.equal(listGames().length, 20);
    assert.equal(listGames()[0].id, 'g24');
    assert.deepEqual(
      listGames(3).map((game) => game.id),
      ['g24', 'g23', 'g22'],
    );
  });

  it('lists nothing when empty', () => {
    assert.deepEqual(listGames(), []);
  });

  it('clears everything', () => {
    saveGame(gameAt('a', 1));
    clearGames();
    assert.equal(getGame('a'), undefined);
    assert.deepEqual(listGames(), []);
  });
});
