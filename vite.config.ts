import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import checker from 'vite-plugin-checker';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

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
      sourcemap: mode !== 'production',
      minify: 'terser',
      chunkSizeWarningLimit: 900,
      terserOptions: {
        compress: {
          drop_console: mode === 'production',
          drop_debugger: mode === 'production',
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/fabric')) return 'vendor-fabric';
            if (id.includes('node_modules/pdf-lib')) return 'vendor-pdf';
            if (id.includes('node_modules/jszip')) return 'vendor-jszip';
            if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
            if (id.includes('node_modules')) return 'vendor';
            return undefined;
          },
        },
      },
    },

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
