// Bundles the Electron main process and preload script with esbuild.
import { build, context } from 'esbuild';
import { loadBuiltinKeys, obfuscateBuiltinKeys } from './builtin-keys.mjs';

const builtinKeys = await loadBuiltinKeys();
console.log('Built-in credential providers: ' + (Object.keys(builtinKeys).join(', ') || 'none'));
const builtinDefine = { __ATLAS_BUILTIN_KEYS__: JSON.stringify(obfuscateBuiltinKeys(builtinKeys)) };

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'info',
  legalComments: 'none',
};

const configs = [
  { ...common, define: builtinDefine, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs' },
];

if (watch) {
  for (const c of configs) {
    const ctx = await context(c);
    await ctx.watch();
  }
} else {
  await Promise.all(configs.map((c) => build(c)));
}
