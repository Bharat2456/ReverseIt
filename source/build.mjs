// Rebuilds the web UI (and, for V3, the serverless API bundle) from source.
// Usage:  npm install   then   npm run build
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).reverseit; // { entry, ui, api? }
const out = path.resolve(here, target.ui);
fs.mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: here, entryPoints: [target.entry], bundle: true, outdir: out, entryNames: 'app', format: 'iife', minify: true,
  target: ['es2020'], jsx: 'automatic', logLevel: 'info', legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('UI built →', out);
if (target.api) {
  const apiDir = path.resolve(here, target.api);
  await build({
    absWorkingDir: here, entryPoints: ['entries/api.ts'], bundle: true, outfile: path.join(apiDir, '_handler.js'), platform: 'node', format: 'cjs',
    target: 'node20', logLevel: 'info', footer: { js: 'module.exports=module.exports.default||module.exports;' },
  });
  for (const f of ['health.js', 'ai/detect.js', 'ai/models.js', 'ai/test.js', 'ai/chat.js', 'site/analyze.js']) {
    fs.mkdirSync(path.dirname(path.join(apiDir, f)), { recursive: true });
    fs.copyFileSync(path.join(apiDir, '_handler.js'), path.join(apiDir, f));
  }
  fs.rmSync(path.join(apiDir, '_handler.js'));
  console.log('API built →', apiDir);
}
