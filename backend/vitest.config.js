import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      SESSION_SECRET: 'test-secret-do-not-use-in-prod',
      // The API suites exercise routes behind the takedown gate, so it is off by default here.
      // takedown.test.js stubs this back on for its own cases.
      SITE_TAKEDOWN: 'off',
    },
  },
});
