const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./load-typescript.cjs');
const model = load('src/features/chat/chat.model.ts');
const { createChatStore } = load('src/features/chat/chat.store.ts', { './chat.model': model });

const fixture = () => {
  const files = new Map();
  let failWrite = false;
  class Directory {
    constructor(...parts) { this.uri = parts.map((part) => part.uri ?? part).join('/'); }
    create() {}
  }
  class File {
    constructor(...parts) { this.uri = parts.map((part) => part.uri ?? part).join('/'); }
    get exists() { return files.has(this.uri); }
    textSync() { return files.get(this.uri); }
    write(text) {
      if (failWrite) { files.set(this.uri, text.slice(0, 15)); throw new Error('Disk full'); }
      files.set(this.uri, text);
    }
  }
  const { createChatRepository } = load('src/features/chat/chat.storage.ts', {
    'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } },
    './chat.model': model,
  });
  const reopen = () => {
    const store = createChatStore(createChatRepository());
    store.hydrate();
    return store;
  };
  return { files, reopen, createChatRepository, setFailure: (value) => { failWrite = value; } };
};

test('selection only populates a draft; whitespace never creates a chat or sends', () => {
  const { reopen, files } = fixture();
  const store = reopen();
  store.setDraft('What’s changed in my market this month?');
  assert.equal(store.getSnapshot().conversations.length, 0);
  assert.equal(files.size, 0);
  store.setDraft(' \n\t  ');
  assert.equal(store.sendMessage(), false);
  assert.equal(files.size, 0);
});

test('messages, multiple chats and selected conversation survive a completely fresh store', () => {
  const { reopen } = fixture();
  const store = reopen();
  store.setDraft('  What’s changed in my market this month?  ');
  assert.equal(store.sendMessage(), true);
  const first = store.getSnapshot().activeConversationId;
  store.setDraft('Look at inventory in particular.');
  store.sendMessage();
  store.newChat();
  store.setDraft('How should I price my next spec?');
  store.sendMessage();
  const second = store.getSnapshot().activeConversationId;
  assert.notEqual(first, second);
  store.openChat(first);
  const restored = reopen().getSnapshot();
  assert.equal(restored.activeConversationId, first);
  assert.equal(restored.conversations.length, 2);
  const conversation = restored.conversations.find((item) => item.id === first);
  assert.equal(conversation.title, 'What’s changed in my market this month?');
  assert.equal(conversation.messages.length, 2);
  assert.ok(conversation.messages.every((message) => message.role === 'user'));
  assert.equal(conversation.messages[1].content, 'Look at inventory in particular.');
  assert.equal(model.ATLAS_DISCONNECTED_MESSAGE, 'Atlas isn’t connected yet.');
});

test('search finds case-insensitive terms across titles and later messages', () => {
  const { reopen } = fixture();
  const store = reopen();
  store.setDraft('Community pricing'); store.sendMessage();
  store.setDraft('Consider the northside inventory.'); store.sendMessage();
  store.newChat(); store.setDraft('Sales playbook'); store.sendMessage();
  const all = store.getSnapshot().conversations;
  assert.equal(model.searchConversations(all, '  INVENTORY   pricing ')[0].title, 'Community pricing');
  assert.equal(model.searchConversations(all, 'not found').length, 0);
  assert.equal(model.searchConversations(all, '  ').length, 2);
});

test('new chats are saved immediately and draft text stays with its own conversation during navigation', () => {
  const { reopen } = fixture();
  const store = reopen();
  store.newChat();
  const first = store.getSnapshot().activeConversationId;
  store.setDraft('Unsent first draft');
  store.newChat();
  const second = store.getSnapshot().activeConversationId;
  assert.equal(store.getSnapshot().drafts[second], undefined);
  store.setDraft('Unsent second draft');
  store.openChat(first);
  assert.equal(store.getSnapshot().drafts[first], 'Unsent first draft');
  assert.equal(store.getSnapshot().drafts[second], 'Unsent second draft');
  assert.equal(reopen().getSnapshot().conversations.length, 2);
});

test('rapid consecutive sends use current state without lost updates or duplicate blank sends', () => {
  const { reopen } = fixture();
  const store = reopen();
  for (let i = 0; i < 20; i++) { store.setDraft(`Message ${i}`); store.sendMessage(); }
  assert.equal(store.sendMessage(), false);
  const conversation = reopen().getSnapshot().conversations[0];
  assert.equal(conversation.messages.length, 20);
  assert.equal(new Set(conversation.messages.map((message) => message.id)).size, 20);
});

test('a failed partial write preserves the draft and previous durable history; retry succeeds', () => {
  const { reopen, setFailure } = fixture();
  const store = reopen();
  store.setDraft('Durable message'); store.sendMessage();
  const id = store.getSnapshot().activeConversationId;
  setFailure(true);
  store.setDraft('Retry me');
  assert.equal(store.sendMessage(), false);
  assert.match(store.getSnapshot().error, /Couldn’t save/);
  assert.equal(store.getSnapshot().drafts[id], 'Retry me');
  const recovered = reopen().getSnapshot();
  assert.match(recovered.error, /Recovered/);
  assert.equal(recovered.conversations[0].messages.length, 1);
  setFailure(false);
  assert.equal(store.sendMessage(), true);
  assert.equal(reopen().getSnapshot().conversations[0].messages.length, 2);
});

test('unreadable or unsupported history blocks mutation without overwriting files', () => {
  const { reopen, files } = fixture();
  files.set('file:///documents/atlas-chats/history-1.json', '{broken');
  files.set('file:///documents/atlas-chats/history-0.json', '{"version":99}');
  const before = [...files];
  const store = reopen();
  assert.equal(store.getSnapshot().ready, false);
  assert.match(store.getSnapshot().error, /kept/);
  store.setDraft('Do not overwrite history');
  assert.equal(store.sendMessage(), false);
  assert.equal(store.newChat(), false);
  assert.deepEqual([...files], before);
});

test('repository refuses pre-hydration writes and invalid data', () => {
  const { createChatRepository, reopen } = fixture();
  const repo = createChatRepository();
  assert.throws(() => repo.save({ conversations: [], activeConversationId: null }), /not loaded/);
  repo.load();
  assert.throws(() => repo.save({ conversations: [], activeConversationId: 'missing' }), /Invalid/);
  assert.throws(() => model.appendMessage(model.createConversation(), 'x'.repeat(model.MAX_MESSAGE_LENGTH + 1)), /too long/);
  const store = reopen();
  store.setDraft('x'.repeat(model.MAX_MESSAGE_LENGTH + 1));
  assert.equal(store.sendMessage(), false);
  assert.match(store.getSnapshot().error, /too long/);
  assert.equal(store.getSnapshot().conversations.length, 0);
});
