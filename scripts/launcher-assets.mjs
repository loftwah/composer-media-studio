// MIT. Check/emit the small browser scripts without a second build framework.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// Authored strict TypeScript under src/browser and the exact browser entry paths
// they ship as. Each header is the source pointer kept at the top of its output;
// the classic assets stay import-free, so they bind at defer-evaluation time,
// while the route and sign-in return modules keep their relative ES-module
// imports beside the deployed files.
const assets = [
  { source: 'src/browser/launcher.ts', output: 'public/brand/launcher.js', header: '// Generated from src/browser/launcher.ts; edit that source. MIT.\n' },
  { source: 'src/browser/gallery-focus.ts', output: 'public/gallery-focus.js', header: '// Generated from src/browser/gallery-focus.ts; edit that source.\n' },
  { source: 'src/browser/public-piece.ts', output: 'public/public-piece.js', header: '// Generated from src/browser/public-piece.ts; edit that source.\n' },
  { source: 'src/browser/compare.ts', output: 'public/compare.js', header: '// Generated from src/browser/compare.ts; edit that source.\n' },
  { source: 'src/browser/review.ts', output: 'public/review.js', header: '// Generated from src/browser/review.ts; edit that source.\n' },
  { source: 'src/browser/recipe-selection.ts', output: 'public/recipe-selection.js', header: '// Generated from src/browser/recipe-selection.ts; edit that source.\n' },
  { source: 'src/browser/voice-handoff.ts', output: 'public/voice-handoff.js', header: '// Generated from src/browser/voice-handoff.ts; edit that source.\n' },
  { source: 'src/browser/studio-comparison.ts', output: 'public/studio-comparison.js', header: '// Generated from src/browser/studio-comparison.ts; edit that source.\n' },
  { source: 'src/browser/studio-route.ts', output: 'public/studio-route.js', header: '// Generated from src/browser/studio-route.ts; edit that source.\n' },
  { source: 'src/browser/studio-login-return.ts', output: 'public/studio-login-return.js', header: '// Generated from src/browser/studio-login-return.ts; edit that source.\n' },
];

export function launcherAsset({ write = false } = {}) {
  const configPath = resolve(root, 'tsconfig.launcher.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const outputs = new Map();
  const emit = program.emit(undefined, (name, bytes) => outputs.set(basename(name), bytes));
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  if (outputs.size !== assets.length) throw Error(`Expected ${assets.length} checked browser outputs, saw ${outputs.size}.`);
  let changed = false;
  for (const asset of assets) {
    const bytes = outputs.get(basename(asset.output));
    if (!bytes) throw Error(`Missing compiler output for ${asset.source}.`);
    const content = asset.header + bytes;
    const path = resolve(root, asset.output);
    let before = '';
    try { before = readFileSync(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before === content) continue;
    changed = true;
    if (write) writeFileSync(path, content);
  }
  if (changed && !write) throw Error('Generated browser outputs differ; run node scripts/launcher-assets.mjs --write.');
  return { changed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!['--check', '--write'].includes(process.argv[2])) throw Error('Use --check or --write.');
    const result = launcherAsset({ write: process.argv[2] === '--write' });
    console.log(result.changed ? 'Updated checked browser outputs.' : 'Checked browser outputs match.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
