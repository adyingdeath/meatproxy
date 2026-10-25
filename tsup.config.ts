import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // For debug, can switch off before publishing.
  sourcemap: true,
  splitting: false,
  shims: true,
  dts: false,
});