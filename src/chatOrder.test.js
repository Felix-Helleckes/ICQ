import { splitChats, byRecency, chatTimestamp } from './chatOrder';

const chat = (id, over = {}) => ({ id, name: id, timestamp: 0, ...over });

describe('chatTimestamp', () => {
  test('reads the timestamp, defaulting to 0', () => {
    expect(chatTimestamp({ timestamp: 42 })).toBe(42);
    expect(chatTimestamp({})).toBe(0);
    expect(chatTimestamp(null)).toBe(0);
    expect(chatTimestamp({ timestamp: 'nope' })).toBe(0);
  });
});

describe('byRecency', () => {
  test('newest first', () => {
    const list = [chat('old', { timestamp: 100 }), chat('new', { timestamp: 900 })];
    expect(list.sort(byRecency).map(c => c.id)).toEqual(['new', 'old']);
  });

  test('chats without a timestamp fall back to A→Z instead of arbitrary order', () => {
    // Chats recovered from the app state carry no timestamp at all.
    const list = [chat('Zoe'), chat('anna'), chat('Bob')];
    expect(list.sort(byRecency).map(c => c.id)).toEqual(['anna', 'Bob', 'Zoe']);
  });

  test('a chat with a timestamp always beats one without', () => {
    const list = [chat('nots'), chat('dated', { timestamp: 5 })];
    expect(list.sort(byRecency).map(c => c.id)).toEqual(['dated', 'nots']);
  });
});

describe('splitChats', () => {
  const chats = [
    chat('groupOld', { isGroup: true, timestamp: 100 }),
    chat('directOld', { timestamp: 200 }),
    chat('archivedNew', { archived: true, timestamp: 800 }),
    chat('directNewest', { timestamp: 900 }),
    chat('groupNew', { isGroup: true, timestamp: 700 }),
    chat('archivedOld', { archived: true, timestamp: 300 }),
    chat('archivedGroup', { isGroup: true, archived: true, timestamp: 500 }),
  ];

  test('splits into groups, archived and direct chats', () => {
    const { groups, archived, contacts } = splitChats(chats);
    expect(groups.map(c => c.id)).toEqual(['groupNew', 'groupOld']);
    expect(contacts.map(c => c.id)).toEqual(['directNewest', 'directOld']);
    // An archived group belongs to Archiviert, not to Gruppen.
    expect(archived.map(c => c.id)).toEqual(['archivedNew', 'archivedGroup', 'archivedOld']);
  });

  test('the newest direct chat is first — right below the archived section', () => {
    expect(splitChats(chats).contacts[0].id).toBe('directNewest');
  });

  test('every section is sorted newest first', () => {
    const { groups, archived, contacts } = splitChats(chats);
    for (const section of [groups, archived, contacts]) {
      const stamps = section.map(c => c.timestamp);
      expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    }
  });

  test('search filters by name and keeps the ordering', () => {
    const { contacts } = splitChats(chats, 'direct');
    expect(contacts.map(c => c.id)).toEqual(['directNewest', 'directOld']);
    expect(splitChats(chats, 'nothing-matches').contacts).toEqual([]);
  });

  test('search is case-insensitive', () => {
    expect(splitChats(chats, 'DIRECTNEWEST').contacts.map(c => c.id)).toEqual(['directNewest']);
  });

  test('tolerates junk input', () => {
    expect(splitChats(null)).toEqual({ groups: [], archived: [], contacts: [] });
    expect(splitChats([null, undefined]).contacts).toEqual([]);
  });

  test('does not mutate the caller list', () => {
    const input = [chat('b', { timestamp: 1 }), chat('a', { timestamp: 9 })];
    const before = input.map(c => c.id);
    splitChats(input);
    expect(input.map(c => c.id)).toEqual(before);
  });
});
