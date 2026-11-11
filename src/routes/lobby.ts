import { Router } from 'express';
import { createGame } from '../game.js';
import { subscribe, publish } from '../hub.js';
import { requireName, viewerOf } from '../identity.js';
import { listGames, newGameId, saveGame } from '../store.js';
import { lobbyList, lobbyPage } from '../views.js';

export const lobbyRoutes = Router();

lobbyRoutes.get('/lobby', requireName, (req, res) => {
  const viewer = viewerOf(req) as string;
  res.send(lobbyPage(listGames(), viewer).value);
});

lobbyRoutes.get('/lobby/events', (req, res) => {
  const viewer = viewerOf(req);
  if (viewer === null) {
    res.status(401).send('Choose a name first.');
    return;
  }
  subscribe('lobby', res, {
    viewer,
    event: 'games',
    render: (who) => {
      return lobbyList(listGames(), who).value;
    },
  });
});

lobbyRoutes.post('/games', requireName, (req, res) => {
  const viewer = viewerOf(req) as string;
  const game = createGame(newGameId(), viewer);
  saveGame(game);
  publish('lobby');
  res.redirect(303, `/games/${game.id}`);
});
