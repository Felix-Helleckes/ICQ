#!/usr/bin/env node
/**
 * Generates site/de.html from site/index.html and its I18N dictionary.
 *
 * Why a static page: the German version used to be the English page with its
 * text swapped by JavaScript (?lang=de), canonicalised to the English URL. Google
 * treats that as a duplicate and drops it, so German searches ("ICQ Alternative",
 * "ICQ Nachfolger") could never find the site. A real /de page with its own
 * canonical, title, description and FAQ schema can rank.
 *
 * It also rewrites the FAQPage schema of BOTH pages from the dictionary, so the
 * structured data always matches the visible FAQ (a mismatch is a Google
 * guideline violation).
 *
 *   node scripts/build-site-de.js          write site/de.html, refresh index.html's FAQ schema
 *   node scripts/build-site-de.js --check  exit 1 when either file is out of date (runs in lint/CI)
 *
 * No dependencies: the markup it touches is the page's own, well-formed HTML.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
const SRC = path.join(SITE, 'index.html');
const OUT = path.join(SITE, 'de.html');

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

function readDictionary(html) {
  const m = html.match(/var I18N = (\{[\s\S]*?\n {4}\});/);
  if (!m) throw new Error('I18N dictionary not found in index.html');
  return vm.runInNewContext(`(${m[1]})`);
}

/** Index of the "</tag" that closes the element whose content starts at `from`. */
function findClose(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth -= 1;
      if (!depth) return m.index;
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  throw new Error(`unclosed <${tag}>`);
}

/** Put the dictionary's text into every data-i18n / data-i18n-html element. */
function translateBody(html, dict) {
  const re = /<([a-zA-Z][\w-]*)\b[^>]*?\sdata-i18n(-html)?="([^"]+)"[^>]*>/g;
  let out = '';
  let last = 0;
  let m;
  const missing = [];
  while ((m = re.exec(html))) {
    const [open, tag, isHtml, key] = m;
    const start = m.index + open.length;
    const end = findClose(html, tag, start);
    if (dict[key] == null) { missing.push(key); continue; }
    out += html.slice(last, start) + (isHtml ? dict[key] : escText(dict[key]));
    last = end;
    re.lastIndex = end;
  }
  out += html.slice(last);
  // Image alt texts (image search, screen readers): data-i18n-alt="key".
  out = out.replace(/<img\b[^>]*\sdata-i18n-alt="([^"]+)"[^>]*>/g, (tag, key) => {
    if (dict[key] == null) { missing.push(key); return tag; }
    return tag.replace(/\salt="[^"]*"/, ` alt="${escAttr(dict[key])}"`);
  });
  if (missing.length) throw new Error(`missing German texts: ${missing.join(', ')}`);
  return out;
}

function faqSchema(dict, indent) {
  const questions = Object.keys(dict).filter(k => /^faq\.q\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(q => ({
      '@type': 'Question',
      name: dict[q],
      acceptedAnswer: { '@type': 'Answer', text: dict[`faq.a${q.slice(5)}`] },
    })),
  };
  return JSON.stringify(data, null, 2).split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
}

const FAQ_BLOCK = /(<script type="application\/ld\+json">\s*)\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "FAQPage"[\s\S]*?\n(\s*)<\/script>/;

function withFaq(html, dict) {
  if (!FAQ_BLOCK.test(html)) throw new Error('FAQPage schema block not found');
  return html.replace(FAQ_BLOCK, (all, head, indent) => `${head}${faqSchema(dict, indent)}\n${indent}</script>`);
}

function replaceAll(html, from, to) {
  if (!html.includes(from)) throw new Error(`not found in index.html: ${from.slice(0, 60)}`);
  return html.split(from).join(to);
}

// The head texts appear in several forms; replace each form explicitly.
function headTexts(html, en, de) {
  let out = html;
  const swap = (a, b) => { if (out.includes(a)) out = out.split(a).join(b); };
  for (const k of ['meta.title', 'meta.desc', 'og.title', 'og.desc']) {
    swap(`<title>${escText(en[k])}</title>`, `<title>${escText(de[k])}</title>`);
    swap(`content="${escAttr(en[k])}"`, `content="${escAttr(de[k])}"`);
    swap(JSON.stringify(en[k]), JSON.stringify(de[k])); // JSON-LD
  }
  return out;
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const html = src.replace(/\r\n/g, '\n');
  const { en } = readDictionary(html);
  // Every head text must really be in the English page, or the swap silently misses.
  if (!html.includes(`<title>${escText(en['meta.title'])}</title>`)) throw new Error("<title> differs from I18N.en['meta.title']");
  if (!html.includes(`<meta name="description" content="${escAttr(en['meta.desc'])}" />`)) throw new Error("meta description differs from I18N.en['meta.desc']");
  if (!html.includes(`content="${escAttr(en['og.title'])}"`)) throw new Error("og:title differs from I18N.en['og.title']");
  if (!html.includes(`content="${escAttr(en['og.desc'])}"`)) throw new Error("og:description differs from I18N.en['og.desc']");

  const built = buildPages(src);
  const check = process.argv.includes('--check');
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (check) {
    const stale = [];
    if (built.index !== src) stale.push('site/index.html (FAQ schema)');
    if (built.de !== current) stale.push('site/de.html');
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')} — run: npm run site:build`);
      process.exit(1);
    }
    console.log('site/de.html is up to date.');
    return;
  }
  writePages(built);
}

/** Regenerate both pages (also used by set-site-url.js after a domain change). */
function writePages(built = buildPages(fs.readFileSync(SRC, 'utf8'))) {
  fs.writeFileSync(SRC, built.index);
  fs.writeFileSync(OUT, built.de);
  console.log('Wrote site/de.html (and refreshed the FAQ schema in site/index.html).');
}

function buildPages(src) {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const html = src.replace(/\r\n/g, '\n');
  const { en, de } = readDictionary(html);
  const base = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (!base) throw new Error('canonical not found');

  const index = withFaq(html, en);

  let out = translateBody(index, de);
  out = withFaq(out, de);
  out = headTexts(out, en, de);
  out = out.replace(/<!-- English page\.[\s\S]*?-->\n/, '<!-- GENERATED from index.html by scripts/build-site-de.js. Do not edit; change index.html and run npm run site:build. -->\n');
  out = replaceAll(out, '<html lang="en" data-page-lang="en">', '<html lang="de" data-page-lang="de">');
  out = replaceAll(out, `<link rel="canonical" href="${base}" />`, `<link rel="canonical" href="${base}de" />`);
  out = replaceAll(out, `<meta property="og:url" content="${base}" />`, `<meta property="og:url" content="${base}de" />`);
  out = replaceAll(out, '<meta property="og:locale" content="en_US" />', '<meta property="og:locale" content="de_DE" />\n  <meta property="og:locale:alternate" content="en_US" />');
  return { index: index.replace(/\n/g, nl), de: out.replace(/\n/g, nl) };
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`build-site-de: ${e.message}`); process.exit(1); }
}

module.exports = { buildPages, writePages, translateBody, readDictionary };
