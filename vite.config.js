// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: './', // Default root (if you want to change it, you can use this)
  publicDir: 'public', // Tells Vite where to find the public folder
  build: {
    outDir: 'dist', // Output directory for build
  },
});
