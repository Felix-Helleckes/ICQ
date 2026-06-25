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
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  try {
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    console.log(`  ok   electron/${file}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL electron/${file}`);
    console.error(String(err.stderr || err.message));
  }
}

if (failed > 0) {
  console.error(`\n${failed} Electron file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} Electron files passed the syntax check.`);
