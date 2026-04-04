import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      PERPLEXITY_KEY: 'test-perplexity-key',
    },
  },
});
