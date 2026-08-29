import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4191',
    viewport: { width: 390, height: 844 }, // iPhone-ish, mobile-first
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4191 --strictPort',
    url: 'http://localhost:4191',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
