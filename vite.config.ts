/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // relative asset paths: works on GitHub Pages (/hanter-games/) and at a domain root
  plugins: [react()],
  test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] },
});
