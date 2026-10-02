const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');
const { CustomFile } = require('telegram/client/uploads');
const { buildTelegramVoice } = require('./tg-voice');

const webmB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'voice-chromium.webm')).toString('base64');

test('a recording goes out as voice.ogg with a voice attribute — not as an "unnamed" file', () => {
  const opts = buildTelegramVoice(webmB64, 'audio/webm;codecs=opus', Array(64).fill(50), { CustomFile, Api });
  expect(opts.voiceNote).toBe(true);
  expect(opts.file).toBeInstanceOf(CustomFile);
  expect(opts.file.name).toBe('voice.ogg');
  expect(opts.file.buffer.toString('ascii', 0, 4)).toBe('OggS');
  expect(opts.file.size).toBe(opts.file.buffer.length);
  const [audio] = opts.attributes;
  expect(audio).toBeInstanceOf(Api.DocumentAttributeAudio);
  expect(audio.voice).toBe(true);
  expect(audio.duration).toBe(2);
  expect(audio.waveform.length).toBe(40); // 64 values × 5 bit
});

test('gramjs itself now classifies it as an audio voice message', () => {
  const opts = buildTelegramVoice(webmB64, 'audio/webm', null, { CustomFile, Api });
  const { getAttributes } = require('telegram/Utils');
  const { attrs, mimeType } = getAttributes(opts.file, { attributes: opts.attributes, voiceNote: true });
  expect(mimeType).toBe('audio/ogg');
  const audio = attrs.find(a => a instanceof Api.DocumentAttributeAudio);
  expect(audio.voice).toBe(true);
  expect(audio.waveform).toBeUndefined(); // no bars given → none sent
});

test('an unusable recording is refused instead of sending a broken message', () => {
  expect(() => buildTelegramVoice(Buffer.from('nope').toString('base64'), 'audio/mpeg', null, { CustomFile, Api })).toThrow();
});
