import type { NextFunction, Request, Response } from 'express';

// Part A identity is deliberately naive: a display name in a plain cookie.
// Nothing stops a client from sending any name it likes. Part B replaces this
// with real authentication.

const COOKIE_NAME = 'player';
const MAX_NAME_LENGTH = 24;

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  for (const pair of (header ?? '').split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = pair.slice(0, index).trim();
    try {
      cookies[key] = decodeURIComponent(pair.slice(index + 1).trim());
    } catch {
      // Ignore malformed values.
    }
  }
  return cookies;
};

// Returns the cleaned name, or null if it is not acceptable.
export const cleanName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return null;
  }
  return name;
};

export const viewerOf = (req: Request): string | null => {
  return cleanName(parseCookies(req.headers.cookie)[COOKIE_NAME]);
};

export const setViewer = (res: Response, name: string): void => {
  res.cookie(COOKIE_NAME, name, {
    sameSite: 'lax',
    path: '/',
  });
};

// Only allow redirects to paths on this site.
export const safeNext = (next: unknown): string => {
  if (
    typeof next === 'string' &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('\\')
  ) {
    return next;
  }
  return '/lobby';
};

// Page-route guard: anyone without a name is sent to pick one first.
export const requireName = (req: Request, res: Response, next: NextFunction): void => {
  if (viewerOf(req) === null) {
    res.redirect(`/?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
};
