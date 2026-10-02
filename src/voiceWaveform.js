/**
 * The waveform a voice note shows on the phone: 64 loudness bars, 0–100.
 *
 * WhatsApp expects it with the message; Baileys can only compute it with an extra
 * audio decoder the app does not ship. The renderer has one built in (Web Audio),
 * so the bars are computed here from the recording and sent along.
 */
export function waveformFromSamples(samples, bars = 64) {
  const n = samples?.length || 0;
  if (!n) return [];
  const block = Math.max(1, Math.floor(n / bars));
  const levels = [];
  for (let i = 0; i < bars; i += 1) {
    let sum = 0;
    const start = i * block;
    const end = Math.min(n, start + block);
    for (let j = start; j < end; j += 1) sum += Math.abs(samples[j]);
    levels.push(end > start ? sum / (end - start) : 0);
  }
  const max = Math.max(...levels);
  return levels.map(v => (max > 0 ? Math.round((v / max) * 100) : 0));
}

/** Decode a recording (WebM/Opus from MediaRecorder) and measure it. Never throws. */
export async function waveformFromRecording(arrayBuffer) {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 48000, 48000);
    const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return waveformFromSamples(audio.getChannelData(0));
  } catch (e) {
    return null; // the voice note still goes out, just without bars
  }
}
