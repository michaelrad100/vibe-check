import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      PERPLEXITY_KEY: 'test-perplexity-key',
      PERPLEXITY_MIN_GAP_MS: '0',
    },
  },
});
