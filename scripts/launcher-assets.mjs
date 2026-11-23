// MIT. Check/emit the small classic browser scripts without a second build framework.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// Authored strict TypeScript under src/browser and the exact classic defer paths
// they ship as. Each header is the source pointer kept at the top of its output;
// the script stays classic (no imports) so pageshow binds at defer-evaluation time.
const assets = [
  { source: 'src/browser/launcher.ts', output: 'public/brand/launcher.js', header: '// Generated from src/browser/launcher.ts; edit that source. MIT.\n' },
  { source: 'src/browser/gallery-focus.ts', output: 'public/gallery-focus.js', header: '// Generated from src/browser/gallery-focus.ts; edit that source.\n' },
  { source: 'src/browser/public-piece.ts', output: 'public/public-piece.js', header: '// Generated from src/browser/public-piece.ts; edit that source.\n' },
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
