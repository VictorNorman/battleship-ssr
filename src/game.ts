// Pure Battleship rules. No HTTP, no I/O, no mutation of inputs: every function
// returns new state, which makes the rules easy to unit test.

export const BOARD_SIZE = 10;

export const FLEET: ReadonlyArray<{ name: string; length: number }> = [
  {
    name: 'Carrier',
    length: 5,
  },
  {
    name: 'Battleship',
    length: 4,
  },
  {
    name: 'Cruiser',
    length: 3,
  },
  {
    name: 'Submarine',
    length: 3,
  },
  {
    name: 'Destroyer',
    length: 2,
  },
];

export interface Coord {
  row: number;
  col: number;
}

export interface Ship {
  name: string;
  cells: Coord[];
}

export interface Board {
  ships: Ship[];
  shots: Coord[];
}

export interface Player {
  name: string;
  board: Board;
}

export type GameStatus = 'waiting' | 'playing' | 'over';

export interface Game {
  id: string;
  creator: string;
  players: Player[];
  // Index into `players` of whoever fires next.
  turn: number;
  status: GameStatus;
  winner: string | null;
  // Bumped on every change; used as the SSE event id.
  version: number;
  // Human-readable summary of the latest action.
  message: string;
  createdAt: number;
}

export type Rng = () => number;

export type ShotOutcome = 'miss' | 'hit' | 'sunk';

export interface ShotResult {
  outcome: ShotOutcome;
  shipName: string | null;
}

export type CellView = 'water' | 'ship' | 'hit' | 'miss' | 'sunk';

export class GameError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- coordinates ----------

export const inBounds = (coord: Coord): boolean => {
  return (
    Number.isInteger(coord.row) &&
    Number.isInteger(coord.col) &&
    coord.row >= 0 &&
    coord.row < BOARD_SIZE &&
    coord.col >= 0 &&
    coord.col < BOARD_SIZE
  );
};

export const sameCoord = (a: Coord, b: Coord): boolean => {
  return a.row === b.row && a.col === b.col;
};

// Column letter plus 1-based row number, e.g. {row: 3, col: 1} -> "B4".
export const coordLabel = (coord: Coord): string => {
  return `${String.fromCharCode(65 + coord.col)}${coord.row + 1}`;
};

// ---------- ships and boards ----------

export const placeShips = (rng: Rng = Math.random): Ship[] => {
  const ships: Ship[] = [];
  const taken = new Set<string>();

  for (const { name, length } of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
      const horizontal = rng() < 0.5;
      const row = Math.floor(rng() * (horizontal ? BOARD_SIZE : BOARD_SIZE - length + 1));
      const col = Math.floor(rng() * (horizontal ? BOARD_SIZE - length + 1 : BOARD_SIZE));
      const cells: Coord[] = [];
      for (let i = 0; i < length; i++) {
        cells.push({
          row: horizontal ? row : row + i,
          col: horizontal ? col + i : col,
        });
      }
      if (cells.every((cell) => !taken.has(`${cell.row},${cell.col}`))) {
        cells.forEach((cell) => taken.add(`${cell.row},${cell.col}`));
        ships.push({
          name,
          cells,
        });
        placed = true;
      }
    }
    if (!placed) {
      throw new Error(`Could not place ${name}`);
    }
  }
  return ships;
};

export const newBoard = (rng: Rng = Math.random): Board => {
  return {
    ships: placeShips(rng),
    shots: [],
  };
};

const wasShot = (board: Board, coord: Coord): boolean => {
  return board.shots.some((shot) => sameCoord(shot, coord));
};

export const isSunk = (board: Board, ship: Ship): boolean => {
  return ship.cells.every((cell) => wasShot(board, cell));
};

export const isOver = (board: Board): boolean => {
  return board.ships.every((ship) => isSunk(board, ship));
};

// Fires at a coordinate and returns the new board plus what happened.
export const fire = (
  board: Board,
  target: Coord,
): { board: Board; result: ShotResult } => {
  if (!inBounds(target)) {
    throw new GameError(400, 'That cell is off the board.');
  }
  if (wasShot(board, target)) {
    throw new GameError(409, `You already fired at ${coordLabel(target)}.`);
  }

  const next: Board = {
    ships: board.ships,
    shots: [...board.shots, target],
  };
  const ship = board.ships.find((candidate) => {
    return candidate.cells.some((cell) => sameCoord(cell, target));
  });

  if (!ship) {
    return {
      board: next,
      result: {
        outcome: 'miss',
        shipName: null,
      },
    };
  }
  return {
    board: next,
    result: {
      outcome: isSunk(next, ship) ? 'sunk' : 'hit',
      shipName: ship.name,
    },
  };
};

// Builds a grid of what a viewer may see. When `revealShips` is false, unhit
// ship cells are reported as plain water, so the secret positions never reach
// the rendering code (and therefore never reach the browser).
export const viewBoard = (board: Board, revealShips: boolean): CellView[][] => {
  const grid: CellView[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    grid.push(new Array<CellView>(BOARD_SIZE).fill('water'));
  }

  for (const ship of board.ships) {
    const sunk = isSunk(board, ship);
    for (const cell of ship.cells) {
      if (sunk) {
        grid[cell.row][cell.col] = 'sunk';
      } else if (wasShot(board, cell)) {
        grid[cell.row][cell.col] = 'hit';
      } else if (revealShips) {
        grid[cell.row][cell.col] = 'ship';
      }
    }
  }
  for (const shot of board.shots) {
    if (grid[shot.row][shot.col] === 'water') {
      grid[shot.row][shot.col] = 'miss';
    }
  }
  return grid;
};

// ---------- games ----------

export const createGame = (id: string, creator: string, rng: Rng = Math.random): Game => {
  return {
    id,
    creator,
    players: [
      {
        name: creator,
        board: newBoard(rng),
      },
    ],
    turn: 0,
    status: 'waiting',
    winner: null,
    version: 1,
    message: `${creator} created the game.`,
    createdAt: Date.now(),
  };
};

// Index of the named player in `game.players`, or -1 for a spectator.
export const seatOf = (game: Game, name: string | null): number => {
  if (name === null) {
    return -1;
  }
  return game.players.findIndex((player) => player.name === name);
};

export const joinGame = (game: Game, name: string, rng: Rng = Math.random): Game => {
  if (seatOf(game, name) !== -1) {
    return game;
  }
  if (game.status !== 'waiting' || game.players.length >= 2) {
    throw new GameError(409, 'This game already has two players.');
  }
  return {
    ...game,
    players: [
      ...game.players,
      {
        name,
        board: newBoard(rng),
      },
    ],
    status: 'playing',
    turn: 0,
    version: game.version + 1,
    message: `${name} joined. ${game.players[0].name} fires first.`,
  };
};

export const fireAt = (game: Game, name: string, target: Coord): Game => {
  if (game.status === 'waiting') {
    throw new GameError(409, 'Waiting for an opponent to join.');
  }
  if (game.status === 'over') {
    throw new GameError(409, 'The game is over.');
  }
  const seat = seatOf(game, name);
  if (seat === -1) {
    throw new GameError(403, 'Spectators cannot fire.');
  }
  if (seat !== game.turn) {
    throw new GameError(409, 'It is not your turn.');
  }

  const defenderSeat = 1 - seat;
  const { board, result } = fire(game.players[defenderSeat].board, target);
  const players = game.players.map((player, index) => {
    if (index === defenderSeat) {
      return {
        ...player,
        board,
      };
    }
    return player;
  });

  const where = coordLabel(target);
  let message = `${name} fired at ${where}: miss.`;
  if (result.outcome === 'hit') {
    message = `${name} fired at ${where}: hit!`;
  } else if (result.outcome === 'sunk') {
    message = `${name} fired at ${where} and sunk the ${result.shipName}!`;
  }

  if (isOver(board)) {
    return {
      ...game,
      players,
      status: 'over',
      winner: name,
      version: game.version + 1,
      message: `${message} ${name} wins!`,
    };
  }
  return {
    ...game,
    players,
    turn: defenderSeat,
    version: game.version + 1,
    message,
  };
};
