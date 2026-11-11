import type { Request, Response } from 'express';
import { Router } from 'express';
import { fireAt, GameError, joinGame, type Coord, type Game } from '../game.js';
import { publish, subscribe } from '../hub.js';
import { requireName, viewerOf } from '../identity.js';
import { getGame, saveGame } from '../store.js';
import { gamePage, gamePanel } from '../views.js';

export const gameRoutes = Router();

const isHtmx = (req: Request): boolean => {
  return req.get('HX-Request') === 'true';
};

const gameIdOf = (req: Request): string => {
  return String(req.params.id);
};

// "3,4" -> {row: 3, col: 4}. Anything else is a bad request.
const parseCell = (raw: unknown): Coord => {
  const match = typeof raw === 'string' ? /^(\d{1,2}),(\d{1,2})$/.exec(raw) : null;
  if (!match) {
    throw new GameError(400, 'Choose a cell on the board.');
  }
  return {
    row: Number(match[1]),
    col: Number(match[2]),
  };
};

// Tell everyone watching this game (and the lobby, when its summary changed).
const announce = (game: Game, lobbyChanged: boolean): void => {
  publish(`game:${game.id}`, game.version);
  if (lobbyChanged) {
    publish('lobby');
  }
};

// Answers a state-changing request. HTMX callers get just the updated panel;
// plain form posts get a redirect (success) or the full page (failure).
const respond = (
  req: Request,
  res: Response,
  game: Game,
  viewer: string,
  error: GameError | null,
): void => {
  const status = error?.status ?? 200;
  const notice = error?.message ?? null;
  if (isHtmx(req)) {
    res.status(status).send(gamePanel(game, viewer, notice).value);
  } else if (error) {
    res.status(status).send(gamePage(game, viewer, notice).value);
  } else {
    res.redirect(303, `/games/${game.id}`);
  }
};

gameRoutes.get('/games/:id', requireName, (req, res, next) => {
  const game = getGame(gameIdOf(req));
  if (!game) {
    next();
    return;
  }
  res.send(gamePage(game, viewerOf(req) as string).value);
});

gameRoutes.post('/games/:id/join', requireName, (req, res, next) => {
  const game = getGame(gameIdOf(req));
  if (!game) {
    next();
    return;
  }
  const viewer = viewerOf(req) as string;
  try {
    const updated = joinGame(game, viewer);
    if (updated !== game) {
      saveGame(updated);
      announce(updated, true);
    }
    respond(req, res, updated, viewer, null);
  } catch (error) {
    if (!(error instanceof GameError)) {
      throw error;
    }
    respond(req, res, game, viewer, error);
  }
});

gameRoutes.post('/games/:id/fire', requireName, (req, res, next) => {
  const game = getGame(gameIdOf(req));
  if (!game) {
    next();
    return;
  }
  const viewer = viewerOf(req) as string;
  try {
    const updated = fireAt(game, viewer, parseCell(req.body?.cell));
    saveGame(updated);
    announce(updated, updated.status === 'over');
    respond(req, res, updated, viewer, null);
  } catch (error) {
    if (!(error instanceof GameError)) {
      throw error;
    }
    respond(req, res, game, viewer, error);
  }
});

gameRoutes.get('/games/:id/events', (req, res, next) => {
  const game = getGame(gameIdOf(req));
  if (!game) {
    next();
    return;
  }
  const viewer = viewerOf(req);
  if (viewer === null) {
    res.status(401).send('Choose a name first.');
    return;
  }
  subscribe(
    `game:${game.id}`,
    res,
    {
      viewer,
      event: 'panel',
      // Look the game up again at send time so every event is current.
      render: (who) => {
        return gamePanel(getGame(game.id) ?? game, who).value;
      },
    },
    game.version,
  );
});
