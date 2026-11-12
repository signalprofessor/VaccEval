import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'loopia',
  publicDir: '../public',
  plugins: [react()],
  define: { __VACCEVAL_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'local-preview') },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: '../loopia-dist', emptyOutDir: true },
});
