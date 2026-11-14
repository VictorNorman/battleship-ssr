import { defineConfig } from '@playwright/test';

const PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  // Games live in server memory and each test makes its own, but the lobby is
  // shared, so keep it simple and run one test at a time.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx src/index.ts',
    env: {
      PORT: String(PORT),
    },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
