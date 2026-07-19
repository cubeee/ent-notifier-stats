import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths — works whether the site ends up served from a
  // GitHub Pages project subpath or a root/custom domain later, with no
  // per-deployment config needed.
  base: './',
  build: {
    outDir: 'dist',
  },
  // sqlite-wasm-http's worker needs code-splitting (dynamic import of the
  // wasm loader), which Rollup only supports for ES-module-format workers —
  // the package's own `new Worker(...)` call doesn't pass `{type:'module'}`,
  // so Vite defaults to classic/IIFE workers unless told otherwise here.
  worker: {
    format: 'es',
  },
});
