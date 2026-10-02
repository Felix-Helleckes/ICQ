/**
 * Voice notes: WebM/Opus (what Chromium's MediaRecorder records) → Ogg/Opus (what
 * WhatsApp and Telegram expect for a voice message).
 *
 * Chromium cannot record Ogg, and both messengers treat anything but Ogg/Opus as a
 * plain file: WhatsApp shows a voice note that will not play, Telegram an "unnamed"
 * document. The audio itself is already Opus in both containers, so this is a pure
 * remux — the Opus packets are copied byte for byte, nothing is re-encoded and no
 * native codec is needed.
 *
 *   parseWebmOpus(buffer)  → { packets, channels, preSkip, sampleRate, opusHead }
 *   writeOggOpus(info)     → Buffer (RFC 7845 stream)
 *   toVoiceNote(buffer, mime) → { buffer, mimetype, seconds } for sending
 */

// ── WebM (EBML) ────────────────────────────────────────────────────────────

const ID = {
  EBML: 0x1a45dfa3, SEGMENT: 0x18538067, CLUSTER: 0x1f43b675, TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae, TRACK_NUMBER: 0xd7, CODEC_ID: 0x86, CODEC_PRIVATE: 0x63a2,
  CODEC_DELAY: 0x56aa, AUDIO: 0xe1, SAMPLING_FREQUENCY: 0xb5, CHANNELS: 0x9f,
  SIMPLE_BLOCK: 0xa3, BLOCK_GROUP: 0xa0, BLOCK: 0xa1,
};
// Containers we walk into. Everything else is read (or skipped) as a whole.
// MediaRecorder writes Segment and Cluster with "unknown size" because it streams;
// walking into them instead of jumping over them makes that a non-issue.
const MASTERS = new Set([ID.SEGMENT, ID.CLUSTER, ID.TRACKS, ID.TRACK_ENTRY, ID.AUDIO, ID.BLOCK_GROUP]);

function readId(buf, pos) {
  const first = buf[pos];
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 4 || pos + len > buf.length) throw new Error('webm: bad element id');
  let id = 0;
  for (let i = 0; i < len; i += 1) id = id * 256 + buf[pos + i];
  return { id, len };
}

/** EBML variable-length integer. `unknown` = all value bits set (size not known). */
function readVint(buf, pos) {
  const first = buf[pos];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 8 || pos + len > buf.length) throw new Error('webm: bad size');
  let value = first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i += 1) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: allOnes };
}

function readUint(buf, start, end) {
  let v = 0;
  for (let i = start; i < end; i += 1) v = v * 256 + buf[i];
  return v;
}

function readFloat(buf, start, end) {
  if (end - start === 4) return buf.readFloatBE(start);
  if (end - start === 8) return buf.readDoubleBE(start);
  return 0;
}

/** Split a (Simple)Block payload into frames, honouring the three lacing modes. */
function blockFrames(buf, start, end) {
  const track = readVint(buf, start);
  let pos = start + track.len + 2; // + int16 relative timecode
  const flags = buf[pos];
  pos += 1;
  const lacing = (flags >> 1) & 3;
  if (lacing === 0) return { track: track.value, frames: [buf.subarray(pos, end)] };

  const count = buf[pos] + 1;
  pos += 1;
  const sizes = [];
  if (lacing === 1) { // Xiph
    for (let i = 0; i < count - 1; i += 1) {
      let size = 0;
      let b;
      do { b = buf[pos]; pos += 1; size += b; } while (b === 255);
      sizes.push(size);
    }
  } else if (lacing === 3) { // EBML
    const firstSize = readVint(buf, pos);
    pos += firstSize.len;
    sizes.push(firstSize.value);
    for (let i = 1; i < count - 1; i += 1) {
      const raw = readVint(buf, pos);
      pos += raw.len;
      const bias = 2 ** (7 * raw.len - 1) - 1;
      sizes.push(sizes[i - 1] + (raw.value - bias));
    }
  }
  if (lacing === 2) { // fixed: equal sizes
    const each = (end - pos) / count;
    for (let i = 0; i < count; i += 1) sizes.push(each);
  } else {
    // The last frame takes whatever is left.
    sizes.push(end - pos - sizes.reduce((a, b) => a + b, 0));
  }
  const frames = [];
  for (const size of sizes) {
    if (size < 0 || pos + size > end) throw new Error('webm: bad lacing');
    frames.push(buf.subarray(pos, pos + size));
    pos += size;
  }
  return { track: track.value, frames };
}

function parseWebmOpus(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 4 || buf.readUInt32BE(0) !== ID.EBML) throw new Error('webm: not a WebM file');

  const tracks = new Map(); // number → { codec, codecPrivate, codecDelay, channels, rate }
  let track = null;
  const blocks = [];        // { track, frames }
  let pos = 0;
  while (pos < buf.length) {
    const { id, len: idLen } = readId(buf, pos);
    const size = readVint(buf, pos + idLen);
    const dataStart = pos + idLen + size.len;
    if (MASTERS.has(id)) {
      if (id === ID.TRACK_ENTRY) { track = {}; tracks.set(`pending${tracks.size}`, track); }
      pos = dataStart; // walk into it
      continue;
    }
    if (size.unknown) throw new Error('webm: unknown-size element');
    const dataEnd = Math.min(dataStart + size.value, buf.length);
    switch (id) {
      case ID.TRACK_NUMBER: if (track) track.number = readUint(buf, dataStart, dataEnd); break;
      case ID.CODEC_ID: if (track) track.codec = buf.toString('ascii', dataStart, dataEnd); break;
      case ID.CODEC_PRIVATE: if (track) track.codecPrivate = Buffer.from(buf.subarray(dataStart, dataEnd)); break;
      case ID.CODEC_DELAY: if (track) track.codecDelay = readUint(buf, dataStart, dataEnd); break;
      case ID.CHANNELS: if (track) track.channels = readUint(buf, dataStart, dataEnd); break;
      case ID.SAMPLING_FREQUENCY: if (track) track.rate = readFloat(buf, dataStart, dataEnd); break;
      case ID.SIMPLE_BLOCK:
      case ID.BLOCK:
        blocks.push(blockFrames(buf, dataStart, dataEnd));
        break;
      default: break; // EBML header, Info, Cues, Tags, Void… — not needed
    }
    pos = dataEnd;
  }

  const opus = [...tracks.values()].find(t => t.codec === 'A_OPUS');
  if (!opus) throw new Error('webm: no Opus track');
  const packets = [];
  for (const b of blocks) if (b.track === opus.number) packets.push(...b.frames);
  if (!packets.length) throw new Error('webm: no audio');

  const head = opus.codecPrivate && opus.codecPrivate.toString('ascii', 0, 8) === 'OpusHead' ? opus.codecPrivate : null;
  const channels = head ? head[9] : (opus.channels || 1);
  // Pre-skip: from OpusHead, else from CodecDelay (nanoseconds), else the libopus default.
  const preSkip = head ? head.readUInt16LE(10)
    : opus.codecDelay ? Math.round((opus.codecDelay * 48000) / 1e9) : 312;
  const sampleRate = head ? head.readUInt32LE(12) : Math.round(opus.rate || 48000);
  return { packets, channels, preSkip, sampleRate, opusHead: head };
}

// ── Opus packet duration (RFC 6716 §3.1) ───────────────────────────────────

/** Samples (at 48 kHz) a packet decodes to, read from its TOC byte. */
function opusPacketSamples(pkt) {
  if (!pkt || !pkt.length) return 0;
  const toc = pkt[0];
  const config = toc >> 3;
  let frame;
  if (config < 12) frame = [480, 960, 1920, 2880][config & 3];   // SILK 10/20/40/60 ms
  else if (config < 16) frame = [480, 960][config & 1];          // Hybrid 10/20 ms
  else frame = [120, 240, 480, 960][config & 3];                 // CELT 2.5/5/10/20 ms
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (pkt.length > 1 ? pkt[1] & 0x3f : 0) : 2;
  return frame * frames;
}

// ── Ogg ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let j = 0; j < 8; j += 1) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(buf) {
  let crc = 0;
  for (let i = 0; i < buf.length; i += 1) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function oggPage({ packets, granule, serial, seq, flags }) {
  const segments = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { segments.push(255); n -= 255; }
    segments.push(n); // a 0 here ends a packet whose length is a multiple of 255
  }
  if (segments.length > 255) throw new Error('ogg: page overflow');
  const header = Buffer.alloc(27 + segments.length);
  header.write('OggS', 0, 'ascii');
  header[4] = 0;
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(seq, 18);
  header.writeUInt32LE(0, 22);
  header[26] = segments.length;
  segments.forEach((s, i) => { header[27 + i] = s; });
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function opusHeadPacket({ channels, preSkip, sampleRate }) {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'ascii');
  b[8] = 1;                       // version
  b[9] = channels;
  b.writeUInt16LE(preSkip, 10);
  b.writeUInt32LE(sampleRate, 12);
  b.writeInt16LE(0, 16);          // output gain
  b[18] = 0;                      // mapping family 0: mono/stereo
  return b;
}

function opusTagsPacket(vendor = 'Retrogram') {
  const v = Buffer.from(vendor, 'utf8');
  const b = Buffer.alloc(8 + 4 + v.length + 4);
  b.write('OpusTags', 0, 'ascii');
  b.writeUInt32LE(v.length, 8);
  v.copy(b, 12);
  b.writeUInt32LE(0, 12 + v.length); // no user comments
  return b;
}

/** About one second of audio per page keeps seeking cheap and pages small. */
const PACKETS_PER_PAGE = 50;

function writeOggOpus({ packets, channels, preSkip, sampleRate, opusHead, serial }) {
  const sn = serial == null ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : serial;
  // The recorder's own OpusHead (WebM CodecPrivate) is exactly what Ogg wants.
  const head = opusHead || opusHeadPacket({ channels, preSkip, sampleRate });
  const pages = [
    oggPage({ packets: [head], granule: 0, serial: sn, seq: 0, flags: 0x02 }),
    oggPage({ packets: [opusTagsPacket()], granule: 0, serial: sn, seq: 1, flags: 0 }),
  ];
  let granule = 0;
  let seq = 2;
  let page = [];
  let segs = 0;
  const flush = (last) => {
    pages.push(oggPage({ packets: page, granule, serial: sn, seq, flags: last ? 0x04 : 0 }));
    seq += 1;
    page = [];
    segs = 0;
  };
  packets.forEach((p, i) => {
    const need = Math.floor(p.length / 255) + 1;
    if (page.length && (segs + need > 255 || page.length >= PACKETS_PER_PAGE)) flush(false);
    page.push(p);
    segs += need;
    granule += opusPacketSamples(p);
    if (i === packets.length - 1) flush(true);
  });
  return Buffer.concat(pages);
}

// ── For the bridges ────────────────────────────────────────────────────────

function isOgg(buf) {
  return buf && buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS';
}

/**
 * Turn a recording into something both messengers accept as a voice message.
 * Ogg input passes through; WebM is remuxed. Anything else throws — sending a
 * voice note that cannot play is worse than a clear error.
 */
function toVoiceNote(input, mime = '') {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buf.length) throw new Error('voice: empty recording');
  if (isOgg(buf)) {
    return { buffer: buf, mimetype: 'audio/ogg; codecs=opus', seconds: null };
  }
  if (/webm/i.test(mime) || buf.readUInt32BE(0) === ID.EBML) {
    const info = parseWebmOpus(buf);
    const samples = info.packets.reduce((n, p) => n + opusPacketSamples(p), 0);
    const seconds = Math.max(1, Math.round(Math.max(0, samples - info.preSkip) / 48000));
    return { buffer: writeOggOpus(info), mimetype: 'audio/ogg; codecs=opus', seconds };
  }
  throw new Error(`voice: unsupported recording format (${mime || 'unknown'})`);
}

/** Renderer bars (numbers 0–100) → WhatsApp's waveform bytes, or null if unusable. */
function normalizeWaveform(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const clean = values.map(v => Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
  return Uint8Array.from(clean.slice(0, 64));
}

/** Telegram packs a voice note's waveform as 5-bit values (0–31), little-endian. */
function packTelegramWaveform(values) {
  const wf = normalizeWaveform(values);
  if (!wf) return null;
  const out = Buffer.alloc(Math.ceil((wf.length * 5) / 8));
  wf.forEach((v, i) => {
    const level = Math.round((v * 31) / 100);
    const bit = i * 5;
    const word = level << (bit & 7);
    out[bit >> 3] |= word & 0xff;
    if ((bit >> 3) + 1 < out.length) out[(bit >> 3) + 1] |= word >> 8;
  });
  return out;
}

module.exports = {
  parseWebmOpus, writeOggOpus, opusPacketSamples, toVoiceNote, oggCrc, isOgg,
  normalizeWaveform, packTelegramWaveform,
};
