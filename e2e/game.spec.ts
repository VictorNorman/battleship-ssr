import { expect, test } from '@playwright/test';
import {
  createGame,
  fireButton,
  joinGame,
  newPlayer,
  startGame,
  status,
} from './helpers.js';

test.describe('live play in a real browser', () => {
  test('a second player joining updates the creator without a reload', async ({ browser }) => {
    const ana = await newPlayer(browser, 'Ana');
    const ben = await newPlayer(browser, 'Ben');
    try {
      const path = await createGame(ana.page);
      await expect(status(ana.page)).toHaveText(/Waiting for an opponent/);

      await joinGame(ben.page, path);

      // No navigation on Ana's side: SSE swapped the panel in place.
      await expect(status(ana.page)).toHaveText(/Your turn/);
      await expect(ana.page).toHaveURL(path);
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });

  test('a shot updates both players over HTMX and SSE', async ({ browser }) => {
    const { ana, ben } = await startGame(browser);
    try {
      let navigations = 0;
      ana.page.on('framenavigated', () => {
        navigations += 1;
      });
      ben.page.on('framenavigated', () => {
        navigations += 1;
      });

      await fireButton(ana.page, 'A1').click();

      await expect(status(ana.page)).toHaveText(/Waiting for/);
      await expect(status(ben.page)).toHaveText(/Your turn/);
      await expect(ben.page.locator('#game-panel .muted').first()).toContainText('fired at A1');
      // The cell Ana fired at is no longer a button on her board.
      await expect(fireButton(ana.page, 'A1')).toHaveCount(0);
      expect(navigations).toBe(0);
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });

  test('a rejected move shows its error inside the panel', async ({ browser }) => {
    const { ana, ben } = await startGame(browser);
    try {
      // A second tab for Ana that never hears about the first tab's shot.
      const stale = await ana.context.newPage();
      await stale.route('**/events', async (route) => {
        await route.abort();
      });
      await stale.goto(ana.page.url());
      await expect(fireButton(stale, 'B2')).toBeVisible();

      await fireButton(ana.page, 'A1').click();
      await expect(status(ben.page)).toHaveText(/Your turn/);

      // The stale tab still offers the button; the server answers 409.
      await fireButton(stale, 'B2').click();
      await expect(stale.getByRole('alert')).toHaveText(/not your turn/);
      await expect(stale).toHaveURL(ana.page.url());
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });

  test('shows each player their own fleet and a spectator no ships', async ({ browser }) => {
    const { ana, ben, path } = await startGame(browser);
    const cy = await newPlayer(browser, 'Cy');
    try {
      await cy.page.goto(path);
      await expect(cy.page.locator('.cell--ship')).toHaveCount(0);
      await expect(cy.page.locator('.cell--fireable')).toHaveCount(0);
      await expect(ana.page.locator('.cell--ship')).toHaveCount(17);
      await expect(ben.page.locator('.cell--ship')).toHaveCount(17);

      await fireButton(ana.page, 'A1').click();
      await expect(status(cy.page)).toHaveText(/'s turn/);
      await expect(cy.page.locator('.cell--ship')).toHaveCount(0);
      await expect(cy.page.locator('.cell--hit, .cell--miss')).toHaveCount(1);
    } finally {
      await ana.context.close();
      await ben.context.close();
      await cy.context.close();
    }
  });

  test('plays a whole game to a winner on every screen', async ({ browser }) => {
    const { ana, ben, path } = await startGame(browser);
    const cy = await newPlayer(browser, 'Cy');
    try {
      await cy.page.goto(path);

      // Read Ben's secret fleet from his own screen; only he can see it.
      const labels = await ben.page.locator('.cell--ship').evaluateAll((cells) => {
        return cells.map((cell) => {
          return (cell.getAttribute('aria-label') ?? '').split(':')[0];
        });
      });
      expect(labels).toHaveLength(17);

      for (let i = 0; i < labels.length; i++) {
        await expect(status(ana.page)).toHaveText(/Your turn/);
        await fireButton(ana.page, labels[i]).click();
        if (i < labels.length - 1) {
          // Ben fires at the first open cell; 16 shots can never win.
          await expect(status(ben.page)).toHaveText(/Your turn/);
          await ben.page.locator('.cell--fireable').first().click();
        }
      }

      for (const page of [ana.page, ben.page, cy.page]) {
        await expect(status(page)).toHaveText(`${ana.name} wins!`);
        await expect(page.getByRole('link', {
          name: 'Back to the lobby',
        })).toBeVisible();
        await expect(page.locator('.cell--fireable')).toHaveCount(0);
      }
    } finally {
      await ana.context.close();
      await ben.context.close();
      await cy.context.close();
    }
  });
});

test.describe('lobby', () => {
  test('shows a new game to another player without a reload', async ({ browser }) => {
    const ana = await newPlayer(browser, 'Ana');
    const ben = await newPlayer(browser, 'Ben');
    try {
      await expect(ben.page.getByText(ana.name)).toHaveCount(0);
      await createGame(ana.page);
      await expect(ben.page).toHaveURL(/\/lobby$/);
      const row = ben.page.locator('.game-row', {
        hasText: ana.name,
      });
      await expect(row).toBeVisible();
      await expect(row.getByRole('button', {
        name: 'Join',
      })).toBeVisible();
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });

  test('changes a row from Join to Watch once the game is full', async ({ browser }) => {
    const ana = await newPlayer(browser, 'Ana');
    const ben = await newPlayer(browser, 'Ben');
    const cy = await newPlayer(browser, 'Cy');
    try {
      const path = await createGame(ana.page);
      const row = cy.page.locator('.game-row', {
        hasText: ana.name,
      });
      await expect(row.getByRole('button', {
        name: 'Join',
      })).toBeVisible();

      await joinGame(ben.page, path);

      await expect(row).toContainText(`${ana.name} vs ${ben.name}`);
      await expect(row.getByRole('link', {
        name: 'Watch',
      })).toBeVisible();
    } finally {
      await ana.context.close();
      await ben.context.close();
      await cy.context.close();
    }
  });
});

test.describe('without JavaScript', () => {
  test('the whole flow still works with plain forms and redirects', async ({ browser }) => {
    const ana = await newPlayer(browser, 'Ana', false);
    const ben = await newPlayer(browser, 'Ben', false);
    try {
      const path = await createGame(ana.page);
      await joinGame(ben.page, path);

      await ana.page.reload();
      await fireButton(ana.page, 'A1').click();
      // Post/Redirect/Get: we land back on the game page with the result.
      await expect(ana.page).toHaveURL(path);
      await expect(status(ana.page)).toHaveText(/Waiting for/);
      await expect(ana.page.locator('#game-panel .muted').first()).toContainText('fired at A1');

      // No SSE without JavaScript, so Ben reloads to see the move.
      await ben.page.reload();
      await expect(status(ben.page)).toHaveText(/Your turn/);
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });
});
