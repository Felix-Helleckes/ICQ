#!/usr/bin/env node
/**
 * Rewrite the site's absolute base URL in every place it appears.
 *
 * The landing page hard-codes its own origin a dozen times — canonical,
 * hreflang, og:url, og:image, twitter:image, JSON-LD, robots.txt and the
 * sitemap. Those have to be absolute (OG scrapers and Google reject relative
 * paths), so they cannot be derived at runtime. Changing a domain by hand
 * therefore means finding all of them, and missing one is worse than missing
 * all of them: a canonical pointing at the old host tells Google the new one
 * is a duplicate.
 *
 * Usage:  node scripts/set-site-url.js https://icq-retrogram.de
 */
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const FILES = ['index.html', 'robots.txt', 'sitemap.xml'];

// Everything currently deployed. Update this when the domain changes for good.
const CURRENT = 'https://icq-retrogram.pages.dev';

function main() {
  const next = (process.argv[2] || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(next)) {
    console.error('Usage: node scripts/set-site-url.js https://example.com');
    console.error('       (https only, no trailing slash, no path)');
    process.exit(1);
  }
  if (next === CURRENT) {
    console.log(`Already set to ${CURRENT} — nothing to do.`);
    return;
  }

  let total = 0;
  for (const name of FILES) {
    const file = path.join(SITE, name);
    const before = fs.readFileSync(file, 'utf8');
    const hits = before.split(CURRENT).length - 1;
    if (!hits) continue;
    fs.writeFileSync(file, before.split(CURRENT).join(next));
    console.log(`${name}: ${hits} replaced`);
    total += hits;
  }

  // de.html is generated from index.html — rebuild it with the new URLs.
  require('./build-site-de').writePages();

  // The constant above is the record of what is deployed; leaving it stale
  // would make the next run a no-op against the wrong origin.
  const self = __filename;
  fs.writeFileSync(self, fs.readFileSync(self, 'utf8')
    .replace(`const CURRENT = '${CURRENT}';`, `const CURRENT = '${next}';`));

  console.log(`\n${total} URLs → ${next}`);
  console.log('Remaining by hand: Search Console property, GA4 data stream URL,');
  console.log('the GitHub repo website field, and the links in presse/pitch-mail.md.');
}

main();
