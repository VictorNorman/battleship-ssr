import { randomBytes } from 'node:crypto';
import type { Game } from './game.js';

// In-memory storage. Part B moves this to SQLite.
const games = new Map<string, Game>();

export const newGameId = (): string => {
  return randomBytes(4).toString('hex');
};

export const getGame = (id: string): Game | undefined => {
  return games.get(id);
};

export const saveGame = (game: Game): void => {
  games.set(game.id, game);
};

// Newest first.
export const listGames = (limit = 20): Game[] => {
  return [...games.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

export const clearGames = (): void => {
  games.clear();
};
