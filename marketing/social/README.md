# ICQ Retrogram — Social Media Kit

Ready-to-post promo graphics in portrait **and** landscape, plus square and a
link-preview image. Each comes as both **`.png`** (ready to upload) and **`.svg`**
(vector source for edits). The ICQ look is recreated in SVG, so no proprietary
ICQ assets are bundled.

## Static graphics

| File (`.png` + `.svg`) | Size | Ratio | Use it for |
|------|------|-------|------------|
| `landscape-1600x900` | 1600×900 | 16:9 | X/Twitter post, YouTube thumbnail, blog/forum header |
| `portrait-1080x1920` | 1080×1920 | 9:16 | Instagram/Facebook Story, TikTok/Reels/Shorts cover |
| `square-1080x1080` | 1080×1080 | 1:1 | Instagram/Facebook feed post |
| `og-1200x630` | 1200×630 | ~1.91:1 | Link preview (Open Graph / Twitter card) |

The PNGs are the upload-ready files. Regenerate them from the SVGs anytime with
`node scripts/rasterize-social.js` (uses Playwright's Chromium).

## Animated video (already in the repo)

For actual video posts, screen-record the looping reels (they include the
classic *uh-oh!* sound):

- **Portrait 9:16** (TikTok/Reels/Shorts): `site/reel.html?format=portrait`
- **Landscape 16:9** (YouTube/X): `marketing/hero.html` (or `site/reel.html?format=landscape`)
- Add `&lang=de` for the German version.

## Exporting to PNG/JPG

Social platforms want raster images. Each SVG already declares its exact pixel
size, so any of these produces a pixel-perfect export:

- **Browser:** open the `.svg`, it renders at full size → screenshot at 100 % zoom.
- **Inkscape:** `inkscape portrait-1080x1920.svg --export-filename=portrait.png`
- **librsvg:** `rsvg-convert -o portrait.png portrait-1080x1920.svg`
- **Headless Chrome / online SVG→PNG converter** also works.

## Open Graph

Done — the landing page (`site/index.html`) now serves `site/og.png`
(a copy of `og-1200x630.png`) as its `og:image` / `twitter:image`, so links
shared on Facebook, X, Slack and Discord show the rich preview card.

## Brand quick-reference

- Wordmark: `✿ ICQ Retrogram`
- Tagline: **Your WhatsApp. Like it's 2003.** / *Dein WhatsApp. Als wäre es 2003.*
- Hook: **uh-oh! 🌼**
- Colours: bg `#0e1f38`→`#1c3a63` · teal `#0D6B6B` · accent `#2BBFBF` · flower `#F5C400` · online `#44DD44`
- Skin swatches: ICQ `#0D6B6B` · MSN `#2E86DE` · Classic-green `#5CA52E`
