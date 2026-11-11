import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_SIZE,
  FLEET,
  GameError,
  coordLabel,
  createGame,
  fire,
  fireAt,
  isOver,
  joinGame,
  placeShips,
  viewBoard,
  type Board,
  type Coord,
  type Rng,
} from './game.js';

// Small deterministic RNG (mulberry32) so placement tests are repeatable.
const seeded = (seed: number): Rng => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const totalShipCells = FLEET.reduce((sum, ship) => sum + ship.length, 0);

const allCells = (board: Board): Coord[] => {
  return board.ships.flatMap((ship) => ship.cells);
};

describe('placeShips', () => {
  it('places every ship in bounds without overlap', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ships = placeShips(seeded(seed));
      assert.equal(ships.length, FLEET.length);
      const keys = new Set<string>();
      for (const ship of ships) {
        for (const cell of ship.cells) {
          assert.ok(cell.row >= 0 && cell.row < BOARD_SIZE);
          assert.ok(cell.col >= 0 && cell.col < BOARD_SIZE);
          keys.add(`${cell.row},${cell.col}`);
        }
      }
      assert.equal(keys.size, totalShipCells);
    }
  });

  it('keeps each ship in a straight line', () => {
    for (const ship of placeShips(seeded(7))) {
      const rows = new Set(ship.cells.map((cell) => cell.row));
      const cols = new Set(ship.cells.map((cell) => cell.col));
      assert.ok(rows.size === 1 || cols.size === 1);
    }
  });
});

describe('fire', () => {
  const board: Board = {
    ships: [
      {
        name: 'Destroyer',
        cells: [
          {
            row: 0,
            col: 0,
          },
          {
            row: 0,
            col: 1,
          },
        ],
      },
    ],
    shots: [],
  };

  it('reports a miss', () => {
    const { result } = fire(board, {
      row: 5,
      col: 5,
    });
    assert.equal(result.outcome, 'miss');
  });

  it('reports a hit, then a sunk ship', () => {
    const first = fire(board, {
      row: 0,
      col: 0,
    });
    assert.equal(first.result.outcome, 'hit');
    const second = fire(first.board, {
      row: 0,
      col: 1,
    });
    assert.equal(second.result.outcome, 'sunk');
    assert.equal(second.result.shipName, 'Destroyer');
    assert.ok(isOver(second.board));
  });

  it('does not mutate the original board', () => {
    fire(board, {
      row: 0,
      col: 0,
    });
    assert.equal(board.shots.length, 0);
  });

  it('rejects out-of-bounds and repeated shots', () => {
    assert.throws(
      () => {
        fire(board, {
          row: 10,
          col: 0,
        });
      },
      (error: unknown) => error instanceof GameError && error.status === 400,
    );
    const { board: after } = fire(board, {
      row: 3,
      col: 3,
    });
    assert.throws(
      () => {
        fire(after, {
          row: 3,
          col: 3,
        });
      },
      (error: unknown) => error instanceof GameError && error.status === 409,
    );
  });
});

describe('viewBoard', () => {
  it('never reveals unhit ships when hidden', () => {
    const board: Board = {
      ships: placeShips(seeded(3)),
      shots: [],
    };
    const hidden = viewBoard(board, false).flat();
    assert.ok(hidden.every((cell) => cell === 'water'));
  });

  it('shows unhit ships to the owner', () => {
    const board: Board = {
      ships: placeShips(seeded(3)),
      shots: [],
    };
    const shown = viewBoard(board, true).flat();
    assert.equal(shown.filter((cell) => cell === 'ship').length, totalShipCells);
  });

  it('shows hits and misses even when hidden, and reveals sunk ships', () => {
    const board: Board = {
      ships: [
        {
          name: 'Destroyer',
          cells: [
            {
              row: 0,
              col: 0,
            },
            {
              row: 0,
              col: 1,
            },
          ],
        },
      ],
      shots: [
        {
          row: 0,
          col: 0,
        },
        {
          row: 4,
          col: 4,
        },
      ],
    };
    const grid = viewBoard(board, false);
    assert.equal(grid[0][0], 'hit');
    assert.equal(grid[0][1], 'water');
    assert.equal(grid[4][4], 'miss');

    const sunk = viewBoard(
      {
        ...board,
        shots: [
          ...board.shots,
          {
            row: 0,
            col: 1,
          },
        ],
      },
      false,
    );
    assert.equal(sunk[0][0], 'sunk');
    assert.equal(sunk[0][1], 'sunk');
  });
});

describe('game flow', () => {
  const started = () => {
    const game = createGame('g1', 'Ana', seeded(1));
    return joinGame(game, 'Ben', seeded(2));
  };

  it('starts waiting, then plays once a second player joins', () => {
    const game = createGame('g1', 'Ana', seeded(1));
    assert.equal(game.status, 'waiting');
    assert.equal(joinGame(game, 'Ben', seeded(2)).status, 'playing');
  });

  it('treats a repeat join by an existing player as a no-op', () => {
    const game = createGame('g1', 'Ana');
    assert.equal(joinGame(game, 'Ana'), game);
  });

  it('rejects a third player', () => {
    assert.throws(() => joinGame(started(), 'Cy'), GameError);
  });

  it('enforces turn order, spectators, and waiting state', () => {
    const target = {
      row: 0,
      col: 0,
    };
    assert.throws(() => fireAt(createGame('g1', 'Ana'), 'Ana', target), /Waiting/);
    const game = started();
    assert.throws(() => fireAt(game, 'Ben', target), /not your turn/);
    assert.throws(() => fireAt(game, 'Cy', target), /Spectators/);
    assert.equal(fireAt(game, 'Ana', target).turn, 1);
  });

  it('ends the game when all ships are sunk', () => {
    let game = started();
    const targets = allCells(game.players[1].board);
    const misses: Coord[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        const coord = {
          row,
          col,
        };
        if (!game.players[0].board.shots.some((s) => s.row === row && s.col === col)) {
          misses.push(coord);
        }
      }
    }
    // Ana sinks everything; Ben burns shots on distinct cells of Ana's board.
    targets.forEach((cell, index) => {
      game = fireAt(game, 'Ana', cell);
      if (game.status === 'playing') {
        game = fireAt(game, 'Ben', misses[index]);
      }
    });
    assert.equal(game.status, 'over');
    assert.equal(game.winner, 'Ana');
    assert.throws(() => fireAt(game, 'Ben', misses[40]), /over/);
  });
});

describe('coordLabel', () => {
  it('formats a column letter and row number', () => {
    assert.equal(
      coordLabel({
        row: 3,
        col: 1,
      }),
      'B4',
    );
  });
});
