import { waveformFromSamples } from './voiceWaveform';

test('64 bars, loudest = 100, silence = 0', () => {
  const samples = new Float32Array(6400);
  for (let i = 3200; i < 3300; i += 1) samples[i] = 0.8; // one loud spot in bar 32
  const bars = waveformFromSamples(samples);
  expect(bars).toHaveLength(64);
  expect(bars[32]).toBe(100);
  expect(bars[0]).toBe(0);
  expect(Math.max(...bars)).toBe(100);
});

test('levels scale relative to the loudest bar', () => {
  const samples = new Float32Array(640);
  samples.fill(0.5, 0, 10);   // bar 0
  samples.fill(0.25, 10, 20); // bar 1
  const bars = waveformFromSamples(samples);
  expect(bars.slice(0, 2)).toEqual([100, 50]);
});

test('empty or silent input never produces NaN', () => {
  expect(waveformFromSamples(new Float32Array(0))).toEqual([]);
  expect(waveformFromSamples(new Float32Array(100)).every(v => v === 0)).toBe(true);
  expect(waveformFromSamples(new Float32Array(10))).toHaveLength(64); // shorter than 64 samples
});
