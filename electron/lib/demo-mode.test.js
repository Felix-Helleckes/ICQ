const { createDemo, isDemoPhone, isDemoCode } = require('./demo-mode');

function setup() {
  const sent = [];
  const timers = [];
  const demo = createDemo({
    broadcast: (channel, data) => sent.push({ channel, data }),
    setTimer: (fn) => timers.push(fn),
  });
  return { demo, sent, flush: () => timers.splice(0).forEach((fn) => fn()) };
}

test('only the demo number and code unlock the demo', () => {
  expect(isDemoPhone('+1 555 555 0123')).toBe(true);
  expect(isDemoPhone('+15555550123')).toBe(true);
  expect(isDemoPhone('+49 170 1234567')).toBe(false);
  expect(isDemoCode('24680')).toBe(true);
  expect(isDemoCode('12345')).toBe(false);
});

test('both networks list invented chats without raw ids', async () => {
  const { demo } = setup();
  const wa = await demo.wa.getChats();
  const tg = await demo.tg.getDialogs();
  expect(wa.length).toBeGreaterThan(2);
  expect(tg.length).toBeGreaterThan(2);
  for (const c of [...wa, ...tg]) expect(c.name).not.toMatch(/@/);
  expect(demo.wa.getStatus()).toBe('ready');
  expect(demo.tg.getStatus()).toBe('ready');
});

test('a WhatsApp message gets receipts and an answer', async () => {
  const { demo, sent, flush } = setup();
  const [chat] = await demo.wa.getChats();
  await demo.wa.sendMessage(chat.id, 'Hello');
  const own = sent.find((s) => s.channel === 'wa:message').data;
  expect(own).toMatchObject({ chatId: chat.id, fromMe: true, body: 'Hello', ack: 1 });
  flush();
  expect(sent.filter((s) => s.channel === 'wa:ack').map((s) => s.data.ack)).toEqual([2, 3]);
  const reply = sent.filter((s) => s.channel === 'wa:message').pop().data;
  expect(reply.fromMe).toBe(false);
  const messages = await demo.wa.getMessages(chat.id);
  expect(messages.slice(-2).map((m) => m.fromMe)).toEqual([true, false]);
});

test('Telegram send returns the entry the chat window merges', async () => {
  const { demo } = setup();
  const [chat] = await demo.tg.getDialogs();
  const entry = await demo.tg.sendMessage(chat.id, 'Hi');
  expect(entry).toMatchObject({ body: 'Hi', fromMe: true });
  expect(entry.id).toBeTruthy();
});

test('archiving, editing and deleting change the demo data', async () => {
  const { demo } = setup();
  const [chat] = await demo.tg.getDialogs();
  await demo.tg.setArchive(chat.id, true);
  expect((await demo.tg.getDialogs()).find((c) => c.id === chat.id).archived).toBe(true);
  const [first] = await demo.tg.getMessages(chat.id);
  await demo.tg.editMessage(chat.id, first.id, 'changed');
  expect((await demo.tg.getMessages(chat.id))[0].body).toBe('changed');
  await demo.tg.deleteMessage(chat.id, first.id);
  expect((await demo.tg.getMessages(chat.id)).find((m) => m.id === first.id)).toBeUndefined();
});

test('logging out of either network ends the demo', async () => {
  const onLogout = jest.fn();
  const demo = createDemo({ broadcast: () => {}, onLogout, setTimer: () => {} });
  await demo.wa.logout();
  await demo.tg.logout();
  expect(onLogout).toHaveBeenCalledTimes(2);
});
