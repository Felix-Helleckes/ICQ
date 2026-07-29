#!/usr/bin/env node
/**
 * Cross-platform syntax check for the Electron main-process code.
 *
 * Jest/CRA only exercise the React renderer (src/). The Electron side
 * (electron/*.js) is never imported by those tests, so a syntax error there
 * would sail through CI and only blow up at runtime — exactly the kind of
 * "works on my machine" regression we want to catch on every platform.
 *
 * Spawning `node --check` keeps this identical on Windows/macOS/Linux.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'electron');

// Recurse so helpers under electron/lib/ are checked too. Skip *.test.js —
// those are exercised (and thus syntax-checked) by `npm run test:electron`.
function collect(base) {
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}
const files = collect(dir);

let failed = 0;
for (const full of files) {
  const rel = path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    console.log(`  ok   ${rel}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${rel}`);
    console.error(String(err.stderr || err.message));
  }
}

if (failed > 0) {
  console.error(`\n${failed} Electron file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} Electron files passed the syntax check.`);
