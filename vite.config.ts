import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/table-maze/
export default defineConfig({
  base: '/table-maze/',
  build: { outDir: 'dist', target: 'es2020' },
});
