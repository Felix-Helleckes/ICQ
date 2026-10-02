/**
 * What gramjs needs to send a recording as a real Telegram voice message.
 *
 * gramjs decides "is this audio?" from the FILE NAME only. A bare Buffer becomes
 * "unnamed" / application/octet-stream, its voiceNote flag is silently dropped,
 * and the recording arrived as an anonymous file. So: Ogg/Opus (lib/ogg-opus.js),
 * a CustomFile named voice.ogg, and an explicit voice attribute with duration and
 * waveform.
 */
const { toVoiceNote, packTelegramWaveform } = require('./ogg-opus');

function buildTelegramVoice(base64Data, mimeType, waveform, { CustomFile, Api }) {
  const voice = toVoiceNote(Buffer.from(String(base64Data || ''), 'base64'), mimeType);
  const file = new CustomFile('voice.ogg', voice.buffer.length, '', voice.buffer);
  const wf = packTelegramWaveform(waveform);
  const attributes = [new Api.DocumentAttributeAudio({
    voice: true,
    duration: voice.seconds || 1,
    ...(wf ? { waveform: wf } : {}),
  })];
  return { file, voiceNote: true, attributes };
}

module.exports = { buildTelegramVoice };
