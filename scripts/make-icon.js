const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const png2icons = require('png2icons');

const publicDir = path.join(__dirname, '..', 'public');

// Draw the icon using Jimp: teal background + golden flower text not possible directly,
// so we create a solid teal square with "ICQ" branding as a programmatic PNG
async function buildIcon() {
  const size = 256;
  const img = new Jimp({ width: size, height: size, color: 0x1A8A8AFF });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded corners (radius 40)
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      if (dx < 40 && dy < 40 && Math.hypot(dx - 40, dy - 40) > 40) {
        img.setPixelColor(0x00000000, x, y);
        continue;
      }
      // Top-to-bottom gradient: teal → dark teal
      const ratio = y / size;
      const r = Math.round(0x0D + (0x0A - 0x0D) * ratio);
      const g = Math.round(0x6B + (0x40 - 0x6B) * ratio);
      const b = Math.round(0x6B + (0x40 - 0x6B) * ratio);
      img.setPixelColor(((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | 0xFF, x, y);
    }
  }

  // Print PNG
  const pngPath = path.join(publicDir, 'icon.png');
  await img.write(pngPath);
  console.log('icon.png written');

  // Convert to ICO
  const pngBuffer = fs.readFileSync(pngPath);
  const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC, 0, false, true);
  if (icoBuffer) {
    fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuffer);
    console.log('icon.ico written');
  } else {
    console.error('ICO conversion failed — icon.png will be used');
  }
}

buildIcon().catch(console.error);
