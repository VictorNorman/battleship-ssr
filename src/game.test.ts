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
  inBounds,
  isOver,
  isSunk,
  joinGame,
  newBoard,
  placeShips,
  sameCoord,
  seatOf,
  viewBoard,
  type Board,
  type Coord,
} from './game.js';
import { at, destroyerBoard, duel, seeded } from './testutil.js';

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

const errorWithStatus = (status: number, pattern?: RegExp) => {
  return (error: unknown): boolean => {
    return (
      error instanceof GameError &&
      error.status === status &&
      (pattern === undefined || pattern.test(error.message))
    );
  };
};

describe('inBounds', () => {
  it('accepts all four corners', () => {
    for (const coord of [at(0, 0), at(0, 9), at(9, 0), at(9, 9)]) {
      assert.ok(inBounds(coord));
    }
  });

  it('rejects coordinates just outside the board', () => {
    for (const coord of [at(-1, 0), at(0, -1), at(10, 0), at(0, 10), at(10, 10)]) {
      assert.ok(!inBounds(coord));
    }
  });

  it('rejects non-integers', () => {
    for (const coord of [at(1.5, 2), at(2, 0.1), at(Number.NaN, 0), at(0, Infinity)]) {
      assert.ok(!inBounds(coord));
    }
  });
});

describe('sameCoord', () => {
  it('compares both row and column', () => {
    assert.ok(sameCoord(at(2, 3), at(2, 3)));
    assert.ok(!sameCoord(at(2, 3), at(3, 2)));
    assert.ok(!sameCoord(at(2, 3), at(2, 4)));
    assert.ok(!sameCoord(at(2, 3), at(1, 3)));
  });
});

describe('coordLabel edges', () => {
  it('labels the corners', () => {
    assert.equal(coordLabel(at(0, 0)), 'A1');
    assert.equal(coordLabel(at(9, 9)), 'J10');
    assert.equal(coordLabel(at(9, 0)), 'A10');
    assert.equal(coordLabel(at(0, 9)), 'J1');
  });
});

describe('placeShips edge cases', () => {
  it('gives each ship its fleet name and length, in fleet order', () => {
    const ships = placeShips(seeded(11));
    assert.deepEqual(
      ships.map((ship) => ship.name),
      FLEET.map((ship) => ship.name),
    );
    assert.deepEqual(
      ships.map((ship) => ship.cells.length),
      FLEET.map((ship) => ship.length),
    );
  });

  it('is deterministic for a given seed and varies between seeds', () => {
    assert.deepEqual(placeShips(seeded(5)), placeShips(seeded(5)));
    assert.notDeepEqual(placeShips(seeded(5)), placeShips(seeded(6)));
  });

  it('lays cells out consecutively', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const ship of placeShips(seeded(seed))) {
        const horizontal = ship.cells.every((cell) => cell.row === ship.cells[0].row);
        ship.cells.forEach((cell, index) => {
          assert.equal(cell.row, ship.cells[0].row + (horizontal ? 0 : index));
          assert.equal(cell.col, ship.cells[0].col + (horizontal ? index : 0));
        });
      }
    }
  });

  it('uses both orientations across seeds', () => {
    const orientations = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const ship of placeShips(seeded(seed))) {
        orientations.add(ship.cells[0].row === ship.cells[1].row ? 'horizontal' : 'vertical');
      }
    }
    assert.deepEqual([...orientations].sort(), ['horizontal', 'vertical']);
  });

  it('gives up with an error if ships cannot be placed', () => {
    // An RNG stuck at 0 always proposes the same spot, so the second ship collides.
    assert.throws(() => placeShips(() => 0), /Could not place Battleship/);
  });
});

describe('newBoard', () => {
  it('starts with a full fleet and no shots', () => {
    const board = newBoard(seeded(2));
    assert.equal(board.ships.length, FLEET.length);
    assert.deepEqual(board.shots, []);
  });
});

describe('isSunk and isOver', () => {
  it('needs every cell of a ship to be hit', () => {
    const board = destroyerBoard();
    const ship = board.ships[0];
    assert.ok(!isSunk(board, ship));
    assert.ok(
      !isSunk(
        {
          ...board,
          shots: [at(0, 0)],
        },
        ship,
      ),
    );
    assert.ok(
      isSunk(
        {
          ...board,
          shots: [at(0, 1), at(0, 0)],
        },
        ship,
      ),
    );
  });

  it('is not over until every ship is sunk', () => {
    const board: Board = {
      ships: [...destroyerBoard(0).ships, ...destroyerBoard(5).ships],
      shots: [at(0, 0), at(0, 1)],
    };
    assert.ok(!isOver(board));
    assert.ok(
      isOver({
        ...board,
        shots: [...board.shots, at(5, 0), at(5, 1)],
      }),
    );
  });

  it('is not over on a fresh board', () => {
    assert.ok(!isOver(newBoard(seeded(4))));
  });
});

describe('fire edge cases', () => {
  const board = destroyerBoard();

  it('rejects every kind of off-board target with 400', () => {
    for (const target of [at(-1, 0), at(0, -1), at(0, 10), at(1.5, 1), at(Number.NaN, 0)]) {
      assert.throws(() => fire(board, target), errorWithStatus(400, /off the board/));
    }
  });

  it('names the cell in the repeated-shot error', () => {
    const { board: after } = fire(board, at(2, 2));
    assert.throws(() => fire(after, at(2, 2)), errorWithStatus(409, /C3/));
  });

  it('rejects a repeat shot at a hit cell too', () => {
    const { board: after } = fire(board, at(0, 0));
    assert.throws(() => fire(after, at(0, 0)), errorWithStatus(409));
  });

  it('reports the ship name on a hit and null on a miss', () => {
    assert.equal(fire(board, at(0, 0)).result.shipName, 'Destroyer');
    assert.equal(fire(board, at(7, 7)).result.shipName, null);
  });

  it('appends shots in order and leaves the ships untouched', () => {
    const first = fire(board, at(1, 1));
    const second = fire(first.board, at(2, 2));
    assert.deepEqual(second.board.shots, [at(1, 1), at(2, 2)]);
    assert.equal(second.board.ships, board.ships);
  });

  it('says hit rather than sunk while another cell remains', () => {
    const twoShips: Board = {
      ships: [...destroyerBoard(0).ships, ...destroyerBoard(5).ships],
      shots: [],
    };
    const first = fire(twoShips, at(0, 0));
    assert.equal(first.result.outcome, 'hit');
    const second = fire(first.board, at(0, 1));
    assert.equal(second.result.outcome, 'sunk');
    assert.ok(!isOver(second.board));
  });
});

describe('viewBoard edge cases', () => {
  it('is always a 10x10 grid', () => {
    const grid = viewBoard(newBoard(seeded(1)), true);
    assert.equal(grid.length, BOARD_SIZE);
    assert.ok(grid.every((row) => row.length === BOARD_SIZE));
  });

  it('is all water for an empty board with no ships revealed', () => {
    const empty: Board = {
      ships: [],
      shots: [],
    };
    const grid = viewBoard(empty, true).flat();
    assert.ok(grid.every((cell) => cell === 'water'));
  });

  it('shows an owner their hits, misses, and remaining ship cells', () => {
    const board: Board = {
      ...destroyerBoard(),
      shots: [at(0, 0), at(3, 3)],
    };
    const grid = viewBoard(board, true);
    assert.equal(grid[0][0], 'hit');
    assert.equal(grid[0][1], 'ship');
    assert.equal(grid[3][3], 'miss');
  });

  it('marks a sunk ship as sunk for everyone', () => {
    const board: Board = {
      ...destroyerBoard(),
      shots: [at(0, 0), at(0, 1)],
    };
    for (const reveal of [true, false]) {
      const grid = viewBoard(board, reveal);
      assert.equal(grid[0][0], 'sunk');
      assert.equal(grid[0][1], 'sunk');
    }
  });

  it('does not reveal a neighboring ship when one ship sinks', () => {
    const board: Board = {
      ships: [...destroyerBoard(0).ships, ...destroyerBoard(1).ships],
      shots: [at(0, 0), at(0, 1)],
    };
    const grid = viewBoard(board, false);
    assert.equal(grid[0][0], 'sunk');
    assert.equal(grid[1][0], 'water');
    assert.equal(grid[1][1], 'water');
  });

  it('returns a fresh grid each call', () => {
    const board = destroyerBoard();
    const first = viewBoard(board, false);
    first[5][5] = 'miss';
    assert.equal(viewBoard(board, false)[5][5], 'water');
  });
});

describe('game creation and joining', () => {
  it('creates a waiting game with the creator in seat 0', () => {
    const game = createGame('abc', 'Ana', seeded(1));
    assert.equal(game.id, 'abc');
    assert.equal(game.creator, 'Ana');
    assert.equal(game.status, 'waiting');
    assert.equal(game.winner, null);
    assert.equal(game.turn, 0);
    assert.equal(game.version, 1);
    assert.deepEqual(
      game.players.map((player) => player.name),
      ['Ana'],
    );
    assert.match(game.message, /Ana created/);
    assert.ok(game.createdAt > 0);
  });

  it('seats players by name, and spectators at -1', () => {
    const game = joinGame(createGame('g', 'Ana', seeded(1)), 'Ben', seeded(2));
    assert.equal(seatOf(game, 'Ana'), 0);
    assert.equal(seatOf(game, 'Ben'), 1);
    assert.equal(seatOf(game, 'Cy'), -1);
    assert.equal(seatOf(game, null), -1);
  });

  it('bumps the version and announces the join without mutating the original', () => {
    const waiting = createGame('g', 'Ana', seeded(1));
    const playing = joinGame(waiting, 'Ben', seeded(2));
    assert.equal(playing.version, waiting.version + 1);
    assert.equal(playing.turn, 0);
    assert.match(playing.message, /Ben joined\. Ana fires first/);
    assert.equal(waiting.players.length, 1);
    assert.equal(waiting.status, 'waiting');
  });

  it('gives each player an independent board', () => {
    const game = joinGame(createGame('g', 'Ana', seeded(1)), 'Ben', seeded(2));
    assert.notDeepEqual(game.players[0].board.ships, game.players[1].board.ships);
  });

  it('rejects a third player with 409', () => {
    assert.throws(() => joinGame(duel(), 'Cy'), errorWithStatus(409, /two players/));
  });

  it('lets either seated player re-join as a no-op once playing', () => {
    const game = duel();
    assert.equal(joinGame(game, 'Ana'), game);
    assert.equal(joinGame(game, 'Ben'), game);
  });
});

describe('fireAt', () => {
  it('passes the turn after a miss and describes it', () => {
    const next = fireAt(duel(), 'Ana', at(5, 5));
    assert.equal(next.turn, 1);
    assert.equal(next.message, 'Ana fired at F6: miss.');
    assert.equal(next.status, 'playing');
  });

  it('passes the turn after a hit and describes it', () => {
    const next = fireAt(duel(), 'Ana', at(0, 0));
    assert.equal(next.turn, 1);
    assert.equal(next.message, 'Ana fired at A1: hit!');
  });

  it('announces a sunk ship by name', () => {
    let game = fireAt(duel(), 'Ana', at(0, 0));
    game = fireAt(game, 'Ben', at(5, 5));
    assert.equal(game.turn, 0);
    // Destroyer is the only ship, so sinking it also ends the game.
    game = fireAt(game, 'Ana', at(0, 1));
    assert.equal(game.message, 'Ana fired at B1 and sunk the Destroyer! Ana wins!');
  });

  it('ends the game on the final hit and does not pass the turn', () => {
    let game = fireAt(duel(), 'Ana', at(0, 0));
    game = fireAt(game, 'Ben', at(5, 5));
    game = fireAt(game, 'Ana', at(0, 1));
    assert.equal(game.status, 'over');
    assert.equal(game.winner, 'Ana');
    assert.equal(game.turn, 0);
  });

  it('lets the second player win too', () => {
    let game = fireAt(duel(), 'Ana', at(5, 5));
    game = fireAt(game, 'Ben', at(0, 0));
    game = fireAt(game, 'Ana', at(6, 6));
    game = fireAt(game, 'Ben', at(0, 1));
    assert.equal(game.status, 'over');
    assert.equal(game.winner, 'Ben');
  });

  it('bumps the version on every shot', () => {
    const game = duel();
    const next = fireAt(game, 'Ana', at(5, 5));
    assert.equal(next.version, game.version + 1);
    assert.equal(fireAt(next, 'Ben', at(5, 5)).version, game.version + 2);
  });

  it('records the shot only on the defender board and does not mutate the input', () => {
    const game = duel();
    const next = fireAt(game, 'Ana', at(5, 5));
    assert.deepEqual(next.players[1].board.shots, [at(5, 5)]);
    assert.deepEqual(next.players[0].board.shots, []);
    assert.deepEqual(game.players[1].board.shots, []);
    assert.equal(game.turn, 0);
  });

  it('rejects the wrong player, a spectator, and a second shot in a row', () => {
    const game = duel();
    assert.throws(() => fireAt(game, 'Ben', at(5, 5)), errorWithStatus(409, /not your turn/));
    assert.throws(() => fireAt(game, 'Cy', at(5, 5)), errorWithStatus(403));
    const after = fireAt(game, 'Ana', at(5, 5));
    assert.throws(() => fireAt(after, 'Ana', at(6, 6)), errorWithStatus(409, /not your turn/));
  });

  it('rejects off-board and repeated shots without changing the game', () => {
    const game = duel();
    assert.throws(() => fireAt(game, 'Ana', at(10, 0)), errorWithStatus(400));
    const after = fireAt(fireAt(game, 'Ana', at(5, 5)), 'Ben', at(5, 5));
    assert.throws(() => fireAt(after, 'Ana', at(5, 5)), errorWithStatus(409, /already fired/));
    assert.equal(after.turn, 0);
    assert.equal(after.players[1].board.shots.length, 1);
  });

  it('rejects shots before an opponent joins, naming the waiting state', () => {
    const waiting = createGame('g', 'Ana', seeded(1));
    assert.throws(() => fireAt(waiting, 'Ana', at(0, 0)), errorWithStatus(409, /Waiting/));
  });

  it('rejects shots after the game is over, even from spectators', () => {
    let game = fireAt(duel(), 'Ana', at(0, 0));
    game = fireAt(game, 'Ben', at(5, 5));
    game = fireAt(game, 'Ana', at(0, 1));
    assert.throws(() => fireAt(game, 'Ben', at(5, 6)), errorWithStatus(409, /over/));
    assert.throws(() => fireAt(game, 'Cy', at(5, 6)), errorWithStatus(409, /over/));
  });
});
