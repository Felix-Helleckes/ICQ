const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseWebmOpus, writeOggOpus, opusPacketSamples, toVoiceNote, oggCrc } = require('./ogg-opus');

// Recorded with Electron's MediaRecorder (audio/webm;codecs=opus) from Chromium's fake
// microphone — byte for byte what the chat window's mic button produces.
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'voice-chromium.webm'));

/** Minimal Ogg reader: validates every page and reassembles the packets. */
function readOgg(buf) {
  const pages = [];
  const packets = [];
  let pending = [];
  let pos = 0;
  while (pos < buf.length) {
    expect(buf.toString('ascii', pos, pos + 4)).toBe('OggS');
    const nseg = buf[pos + 26];
    const table = [...buf.subarray(pos + 27, pos + 27 + nseg)];
    const bodyLen = table.reduce((a, b) => a + b, 0);
    const page = Buffer.from(buf.subarray(pos, pos + 27 + nseg + bodyLen));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    pages.push({ flags: buf[pos + 5], granule: Number(buf.readBigInt64LE(pos + 6)), seq: buf.readUInt32LE(pos + 18), crcOk: crc === oggCrc(page) });
    let body = pos + 27 + nseg;
    for (const lace of table) {
      pending.push(buf.subarray(body, body + lace));
      body += lace;
      if (lace < 255) { packets.push(Buffer.concat(pending)); pending = []; }
    }
    pos += 27 + nseg + bodyLen;
  }
  return { pages, packets };
}

describe('remuxing a real Chromium recording', () => {
  const info = parseWebmOpus(FIXTURE);
  const voice = toVoiceNote(FIXTURE, 'audio/webm;codecs=opus');
  const ogg = readOgg(voice.buffer);

  test('finds the Opus track and its packets', () => {
    expect(info.channels).toBe(1);
    expect(info.sampleRate).toBe(48000);
    expect(info.packets.length).toBeGreaterThan(20);
  });

  test('produces a valid Ogg/Opus stream: headers, checksums, page order, end marker', () => {
    expect(voice.mimetype).toBe('audio/ogg; codecs=opus');
    expect(ogg.pages.every(p => p.crcOk)).toBe(true);
    expect(ogg.pages.map(p => p.seq)).toEqual(ogg.pages.map((_, i) => i));
    expect(ogg.pages[0].flags).toBe(0x02);                       // beginning of stream
    expect(ogg.pages[ogg.pages.length - 1].flags & 0x04).toBe(0x04); // end of stream
    expect(ogg.packets[0].toString('ascii', 0, 8)).toBe('OpusHead');
    expect(ogg.packets[1].toString('ascii', 0, 8)).toBe('OpusTags');
    const granules = ogg.pages.map(p => p.granule);
    expect([...granules].sort((a, b) => a - b)).toEqual(granules);
  });

  test('is lossless — every Opus packet is copied byte for byte', () => {
    const audio = ogg.packets.slice(2);
    expect(audio).toHaveLength(info.packets.length);
    audio.forEach((p, i) => expect(p.equals(info.packets[i])).toBe(true));
  });

  test('knows the duration (the WebM itself has none — MediaRecorder streams it)', () => {
    const last = ogg.pages[ogg.pages.length - 1].granule;
    expect(last).toBe(info.packets.reduce((n, p) => n + opusPacketSamples(p), 0));
    expect(voice.seconds).toBe(2);
  });

  // Independent check with a real decoder when one is installed (dev machines);
  // CI runners without ffmpeg skip it, the structural checks above still run.
  const ffprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
  (ffprobe ? test : test.skip)('ffprobe/ffmpeg accept it as Ogg/Opus and decode it without errors', () => {
    const file = path.join(os.tmpdir(), `retrogram-voice-${process.pid}.ogg`);
    fs.writeFileSync(file, voice.buffer);
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_name,channels',
        '-of', 'json', file]).toString();
      const j = JSON.parse(out);
      expect(j.format.format_name).toBe('ogg');
      expect(j.streams[0].codec_name).toBe('opus');
      expect(Number(j.format.duration)).toBeGreaterThan(1.5);
      const errors = execFileSync('ffmpeg', ['-v', 'warning', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      expect(errors).toBe('');
    } finally { fs.rmSync(file, { force: true }); }
  });
});

describe('opusPacketSamples (TOC byte)', () => {
  test.each([
    [[(3 << 3) | 0], 2880],          // SILK 60 ms, one frame (what Chromium records)
    [[(1 << 3) | 0], 960],           // SILK 20 ms
    [[(31 << 3) | 0], 960],          // CELT 20 ms
    [[(16 << 3) | 1], 240],          // CELT 2.5 ms × 2 frames
    [[(13 << 3) | 2], 1920],         // Hybrid 20 ms × 2 frames (code 2)
    [[(31 << 3) | 3, 0x03], 2880],   // CELT 20 ms × 3 frames (code 3)
    [[], 0],
  ])('%j → %d samples', (bytes, samples) => {
    expect(opusPacketSamples(Buffer.from(bytes))).toBe(samples);
  });
});

// ── A hand-built WebM: laced frames, unknown sizes, no OpusHead ────────────

function vint(n) { // 8-byte EBML size
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  b.writeUIntBE(n, 2, 6);
  return b;
}
function el(id, ...children) {
  const idBuf = Buffer.from(id.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex');
  const body = Buffer.concat(children.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
  return Buffer.concat([idBuf, vint(body.length), body]);
}
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function unknownSize(id, ...children) {
  return Buffer.concat([Buffer.from(id.toString(16), 'hex'), UNKNOWN, ...children]);
}

test('Xiph-laced blocks in unknown-size clusters, without an OpusHead, still convert', () => {
  const f1 = Buffer.from([(1 << 3) | 0, 1, 2, 3]);       // SILK 20 ms
  const f2 = Buffer.from([(1 << 3) | 0, 4, 5]);
  const lacedBlock = Buffer.concat([
    Buffer.from([0x81, 0x00, 0x00, 0x82]), // track 1, timecode 0, flags: Xiph lacing
    Buffer.from([0x01, f1.length]),        // 2 frames, size of the first
    f1, f2,
  ]);
  const webm = Buffer.concat([
    el(0x1a45dfa3, el(0x4282, 'webm')),
    unknownSize(0x18538067,
      el(0x1654ae6b, el(0xae, el(0xd7, Buffer.from([1])), el(0x86, 'A_OPUS'),
        el(0x56aa, Buffer.from([0x00, 0x63, 0x2e, 0xa0])),   // CodecDelay 6.5 ms
        el(0xe1, el(0x9f, Buffer.from([2]))))),
      unknownSize(0x1f43b675, el(0xe7, Buffer.from([0])), el(0xa3, lacedBlock))),
  ]);

  const info = parseWebmOpus(webm);
  expect(info.packets.map(p => [...p])).toEqual([[...f1], [...f2]]);
  expect(info.channels).toBe(2);
  expect(info.preSkip).toBe(312);                          // 6.5 ms at 48 kHz
  const ogg = readOgg(writeOggOpus({ ...info, serial: 7 }));
  expect(ogg.pages.every(p => p.crcOk)).toBe(true);
  expect(ogg.packets[0][9]).toBe(2);                       // synthesized OpusHead: stereo
  expect(ogg.pages[ogg.pages.length - 1].granule).toBe(1920);
});

describe('toVoiceNote', () => {
  test('an Ogg recording passes through untouched', () => {
    const ogg = toVoiceNote(FIXTURE, 'audio/webm').buffer;
    expect(toVoiceNote(ogg, 'audio/ogg').buffer).toBe(ogg);
  });
  test('refuses what it cannot turn into a playable voice note', () => {
    expect(() => toVoiceNote(Buffer.alloc(0), 'audio/webm')).toThrow(/empty/);
    expect(() => toVoiceNote(Buffer.from('ID3 not a webm'), 'audio/mpeg')).toThrow(/unsupported/);
    expect(() => toVoiceNote(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]), 'audio/webm')).toThrow();
  });
  test('a long recording keeps pages within the Ogg limits', () => {
    const many = Array.from({ length: 2000 }, (_, i) => Buffer.alloc(300 + (i % 7), (3 << 3)));
    const ogg = readOgg(writeOggOpus({ packets: many, channels: 1, preSkip: 0, sampleRate: 48000, serial: 1 }));
    expect(ogg.pages.every(p => p.crcOk)).toBe(true);
    expect(ogg.packets.slice(2)).toHaveLength(2000);
  });
});
