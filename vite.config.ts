import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { spawn } from 'node:child_process';
import checker from 'vite-plugin-checker';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      {
        name: 'measurement-search-page',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (/^\/search(?:\/|\?|$)/.test(req.url || '')) req.url = '/search.html';
            next();
          });
        },
      },
      // Auto-start the Express backend so /api proxy never 502s.
      {
        name: 'openpaint-express-backend',
        configureServer(server) {
          let backend: ReturnType<typeof spawn> | null = null;
          const startBackend = () => {
            backend = spawn('node', ['app.js'], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, FORCE_COLOR: '1' },
            });
            backend.stdout?.on('data', (data: Buffer) => {
              const line = data.toString().trim();
              if (line) console.log(`\x1b[36m[api]\x1b[0m ${line}`);
            });
            backend.stderr?.on('data', (data: Buffer) => {
              const line = data.toString().trim();
              if (line) console.error(`\x1b[31m[api]\x1b[0m ${line}`);
            });
            backend.on('exit', code => {
              if (code !== null && code !== 0 && !backend?.killed) {
                console.log(
                  `\x1b[33m[api] Express exited (code ${code}), restarting in 2s…\x1b[0m`
                );
                setTimeout(startBackend, 2000);
              }
            });
          };
          startBackend();
          server.httpServer?.on('close', () => backend?.kill());
        },
      },
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

    css:
      process.env.OP_SKIP_POSTCSS === '1'
        ? {
            postcss: {
              plugins: [],
            },
          }
        : undefined,

    build: {
      target: 'ES2022',
      cssMinify: 'esbuild',
      sourcemap: mode !== 'production',
      minify: 'esbuild',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          paint: path.resolve(__dirname, 'index.html'),
          search: path.resolve(__dirname, 'search.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/fabric')) return 'vendor-fabric';
            if (id.includes('node_modules/pdf-lib')) return 'vendor-pdf';
            if (id.includes('node_modules/jszip')) return 'vendor-jszip';
            if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
            return undefined;
          },
        },
      },
    },

    esbuild:
      mode === 'production'
        ? {
            drop: ['console', 'debugger'],
          }
        : undefined,

    optimizeDeps: {
      exclude: ['debug'],
    },

    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/ai': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },

    preview: {
      port: 4173,
    },

    // Test config lives in vitest.config.ts (merged via mergeConfig)
  };
});
