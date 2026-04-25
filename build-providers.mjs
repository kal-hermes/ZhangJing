/**
 * Build script: bundles all providers into a single browser-ready JS file.
 * Run: node build-providers.mjs
 *
 * Output: dist/providers.bundle.js  (ES module)
 * Output: dist/providers-shim.js    (attaches exports to window.__zhangjing)
 */

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

mkdirSync(join(root, 'dist'), { recursive: true });

// 1. Build the ES module bundle
await esbuild.build({
  entryPoints: [join(root, 'providers/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  outfile: join(root, 'dist/providers.bundle.js'),
  inject: [join(root, 'providers/shims.mjs')],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
  minify: false,
  sourcemap: true,
});

// 2. Build a shim that attaches bundle exports to window.__zhangjing
await esbuild.build({
  entryPoints: [join(root, 'providers/index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: join(root, 'dist/providers-shim.js'),
  globalName: '__zhangjing',
  inject: [join(root, 'providers/shims.mjs')],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
  minify: false,
  sourcemap: false,
});

console.log('✅ providers.bundle.js (ESM) + providers-shim.js (IIFE window export) built');
