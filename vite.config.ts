import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at https://<user>.github.io/table-maze/
export default defineConfig({
  plugins: [react()],
  base: '/table-maze/',
  build: { outDir: 'dist', target: 'es2020' },
});
