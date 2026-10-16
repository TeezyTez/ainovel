import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    outDir: 'dist/workbench',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/workbench/entry.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'workbench.js',
      cssFileName: 'workbench',
    },
  },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
