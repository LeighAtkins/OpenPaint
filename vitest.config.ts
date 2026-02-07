import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig({ mode: 'test', command: 'serve' }),
  defineConfig({
    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['./tests/helpers/setup.js'],
      include: ['src/**/*.{test,spec}.{ts,tsx,js}', 'tests/**/*.{test,spec}.{js,ts}'],
      exclude: ['node_modules', 'dist'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html', 'lcov'],
        reportsDirectory: './coverage',
        exclude: [
          'node_modules/',
          'src/__tests__/',
          '**/*.d.ts',
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/index.ts',
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
      reporters: ['verbose', 'html'],
      outputFile: {
        html: './test-results/index.html',
      },
    },
  })
);
