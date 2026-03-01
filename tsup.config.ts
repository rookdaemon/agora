import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/relay/relay-server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
});
