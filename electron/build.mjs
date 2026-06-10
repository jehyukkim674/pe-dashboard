import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
