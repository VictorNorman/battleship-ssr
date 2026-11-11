import type { ErrorRequestHandler, RequestHandler } from 'express';
import express from 'express';
import path from 'node:path';
import { viewerOf } from './identity.js';
import { gameRoutes } from './routes/games.js';
import { identityRoutes } from './routes/identity.js';
import { lobbyRoutes } from './routes/lobby.js';
import { errorPage, notFoundPage } from './views.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const notFound: RequestHandler = (req, res) => {
  res.status(404).send(notFoundPage(viewerOf(req), req.path).value);
};

const onError: ErrorRequestHandler = (error, req, res, _next) => {
  console.error(error);
  res.status(500).send(errorPage(viewerOf(req), 'Unexpected server error.').value);
};

export const createApp = (): express.Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    express.urlencoded({
      extended: false,
    }),
  );

  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/vendor/htmx', express.static(path.join(ROOT, 'node_modules/htmx.org/dist')));
  app.use(
    '/vendor/htmx-ext-sse',
    express.static(path.join(ROOT, 'node_modules/htmx-ext-sse/dist')),
  );

  app.use(identityRoutes);
  app.use(lobbyRoutes);
  app.use(gameRoutes);

  app.use(notFound);
  app.use(onError);
  return app;
};
