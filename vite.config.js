import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
export default defineConfig(function (_a) {
  var mode = _a.mode;
  var env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      // Disabled during migration to avoid blocking development
      // checker({
      //   typescript: {
      //     tsconfigPath: './tsconfig.json',
      //   },
      //   eslint: {
      //     lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
      //   },
      //   overlay: {
      //     initialIsOpen: false,
      //     position: 'br',
      //   },
      // }),
    ],
    // Serve static files from public directory
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/types': path.resolve(__dirname, './src/types'),
        '@/services': path.resolve(__dirname, './src/services'),
        '@/utils': path.resolve(__dirname, './src/utils'),
        '@/stores': path.resolve(__dirname, './src/stores'),
        '@/constants': path.resolve(__dirname, './src/constants'),
        '@/hooks': path.resolve(__dirname, './src/hooks'),
      },
    },
    define: {
      __DEV__: mode === 'development',
      __PROD__: mode === 'production',
    },
    build: {
      target: 'ES2022',
      sourcemap: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: mode === 'production',
          drop_debugger: mode === 'production',
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            supabase: ['@supabase/supabase-js'],
          },
        },
        external: ['fabric'], // Fabric.js is loaded via CDN
      },
    },
    optimizeDeps: {
      exclude: [
        'fabric', // Don't try to bundle Fabric.js
        // Exclude public JS files from dependency scanning
        '/js/modules/main.js',
        'js/modules/main.js',
        '/js/typescript-bridge.js',
        'js/typescript-bridge.js',
      ],
    },
    server: {
      port: 3000,
      strictPort: true,
      host: true,
    },
    preview: {
      port: 4173,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/__tests__/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['node_modules/', 'src/__tests__/', '**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
      },
    },
  };
});
