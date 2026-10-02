/**
 * Voice messages, end to end in the real app: mic button → MediaRecorder →
 * IPC → WebM→Ogg/Opus remux → decodable audio.
 *
 * Chromium's fake microphone (a beep) stands in for a real one. The send IPC is
 * intercepted in the main process, so NOTHING is sent anywhere; what WhatsApp would
 * receive is converted exactly like the bridge does and then decoded by Chromium's
 * own audio stack — the same engine WhatsApp Desktop/Web uses to play it.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { toVoiceNote } = require('../electron/lib/ogg-opus');

let app;

test.beforeAll(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icq-e2e-voice-'));
  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      `--user-data-dir=${userDataDir}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env: { ...process.env, ICQ_E2E: '1' },
  });
  await app.firstWindow();
  // Capture instead of send.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('wa:send-voice');
    ipcMain.handle('wa:send-voice', (_e, chatId, base64, mime, waveform) => {
      global.__voiceCalls = (global.__voiceCalls || 0) + 1;
      global.__voice = { chatId, base64, mime, waveform };
      return true;
    });
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('recording in a chat window produces a voice note WhatsApp can play', async () => {
  const list = await app.firstWindow();
  const chatWinPromise = app.waitForEvent('window');
  await list.evaluate(() => window.api.openChat({
    chatId: '491700000001@s.whatsapp.net', chatName: 'Voice Test', service: 'whatsapp', isGroup: false,
  }));
  const chat = await chatWinPromise;
  await chat.waitForLoadState('domcontentloaded');

  const mic = chat.locator('.record-btn');
  await mic.click();
  await expect(mic).toHaveClass(/active/);
  await chat.waitForTimeout(1600);
  await mic.click();
  await expect(mic).not.toHaveClass(/active/);

  await expect.poll(() => app.evaluate(() => global.__voiceCalls || 0), { timeout: 15000 }).toBe(1);
  const call = await app.evaluate(() => global.__voice);
  expect(call.chatId).toBe('491700000001@s.whatsapp.net');
  expect(call.mime).toMatch(/webm/);                       // what Chromium records…
  expect(call.waveform).toHaveLength(64);                   // …plus the bars for the phone
  expect(Math.max(...call.waveform)).toBe(100);

  // Exactly what the bridge sends: Ogg/Opus.
  const voice = toVoiceNote(Buffer.from(call.base64, 'base64'), call.mime);
  expect(voice.mimetype).toBe('audio/ogg; codecs=opus');
  expect(voice.seconds).toBeGreaterThanOrEqual(1);

  const decoded = await chat.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const audio = await ctx.decodeAudioData(bytes.buffer);
    const data = audio.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    return { duration: audio.duration, peak };
  }, voice.buffer.toString('base64'));

  expect(decoded.duration).toBeGreaterThan(1);
  expect(decoded.duration).toBeLessThan(4);
  expect(decoded.peak).toBeGreaterThan(0.01);               // the beep is in there, not silence
});
