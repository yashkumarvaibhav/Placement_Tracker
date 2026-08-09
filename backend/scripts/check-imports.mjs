// Vitest's module runner resolves named imports leniently, so a missing export sails through
// the suite and only fails when systemd starts the real process. This loads every module under
// src/ with Node's own ESM loader, which is the thing that actually rejects it.
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = path.join(dir, entry);
  if (statSync(full).isDirectory()) return walk(full);
  // server.js is the entry point: importing it would start listening and open a DB loop.
  return full.endsWith('.js') && path.basename(full) !== 'server.js' ? [full] : [];
});

let failed = 0;
for (const file of walk(srcDir)) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    failed++;
    console.error(`FAIL ${path.relative(srcDir, file)}: ${err.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} module(s) failed to load.`);
  process.exit(1);
}
console.log('All src modules load under Node.');
