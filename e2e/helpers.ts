import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

let counter = 0;

// Names are at most 24 characters; keep them short and unique per call.
export const uniqueName = (prefix: string): string => {
  counter += 1;
  return `${prefix}${Date.now() % 100000}${counter}`;
};

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

export const signIn = async (page: Page, name: string): Promise<void> => {
  await page.goto('/');
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('button', {
    name: 'Continue',
  }).click();
  await expect(page).toHaveURL(/\/lobby$/);
};

// A fresh browser context (so its own cookie jar) signed in under a new name.
export const newPlayer = async (
  browser: Browser,
  prefix: string,
  javaScriptEnabled = true,
): Promise<Player> => {
  const context = await browser.newContext({
    javaScriptEnabled,
  });
  const page = await context.newPage();
  const name = uniqueName(prefix);
  await signIn(page, name);
  return {
    name,
    context,
    page,
  };
};

// Creates a game from the lobby and returns its path, e.g. "/games/ab12cd34".
export const createGame = async (page: Page): Promise<string> => {
  await page.getByRole('button', {
    name: 'Create a new game',
  }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f]{8}$/);
  return new URL(page.url()).pathname;
};

export const joinGame = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await page.getByRole('button', {
    name: 'Join this game',
  }).click();
  await expect(page).toHaveURL(path);
};

export const status = (page: Page): Locator => {
  return page.locator('#game-panel .status');
};

export const fireButton = (page: Page, label: string): Locator => {
  return page.getByRole('button', {
    name: `Fire at ${label}`,
    exact: true,
  });
};

// Sets up two signed-in players in a started game; Ana has the first shot.
export const startGame = async (
  browser: Browser,
): Promise<{
  ana: Player;
  ben: Player;
  path: string;
}> => {
  const ana = await newPlayer(browser, 'Ana');
  const ben = await newPlayer(browser, 'Ben');
  const path = await createGame(ana.page);
  await joinGame(ben.page, path);
  await expect(status(ana.page)).toHaveText(/Your turn/);
  await expect(status(ben.page)).toHaveText(/Waiting for/);
  return {
    ana,
    ben,
    path,
  };
};
