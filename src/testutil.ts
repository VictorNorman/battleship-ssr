import { createGame, type Board, type Coord, type Game, type Rng } from './game.js';

// Small deterministic RNG (mulberry32) so placement tests are repeatable.
export const seeded = (seed: number): Rng => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const at = (row: number, col: number): Coord => {
  return {
    row,
    col,
  };
};

// A board with a single Destroyer at (row, 0) and (row, 1).
export const destroyerBoard = (row = 0): Board => {
  return {
    ships: [
      {
        name: 'Destroyer',
        cells: [at(row, 0), at(row, 1)],
      },
    ],
    shots: [],
  };
};

// A started game where both players have only a Destroyer at A1-B1, so a whole
// game can be played in a handful of shots.
export const duel = (): Game => {
  return {
    ...createGame('duel', 'Ana', seeded(1)),
    players: [
      {
        name: 'Ana',
        board: destroyerBoard(),
      },
      {
        name: 'Ben',
        board: destroyerBoard(),
      },
    ],
    status: 'playing',
    version: 2,
  };
};
