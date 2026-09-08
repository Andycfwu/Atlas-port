export const ATLAS_DISCONNECTED_MESSAGE = 'Atlas isn’t connected yet.';
export const MAX_MESSAGE_LENGTH = 12_000;

export interface LocalMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: string;
}

export interface LocalConversation {
  id: string;
  title: string;
  messages: LocalMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatLibrary {
  conversations: LocalConversation[];
  activeConversationId: string | null;
}

let sequence = 0;
export const createChatId = () =>
  `chat-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const createConversation = (): LocalConversation => {
  const now = new Date().toISOString();
  return { id: createChatId(), title: 'New chat', messages: [], createdAt: now, updatedAt: now };
};

export const appendMessage = (conversation: LocalConversation, input: string): LocalConversation => {
  const content = input.trim();
  if (!content) throw new Error('Enter a message first.');
  if (content.length > MAX_MESSAGE_LENGTH) throw new Error('This message is too long.');
  const now = new Date().toISOString();
  return {
    ...conversation,
    title: conversation.messages.length ? conversation.title : content.replace(/\s+/g, ' ').slice(0, 80),
    updatedAt: now,
    messages: [...conversation.messages, { id: createChatId(), role: 'user', content, createdAt: now }],
  };
};

export const searchConversations = (conversations: readonly LocalConversation[], query: string) => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...conversations].filter((conversation) => {
    const text = [conversation.title, ...conversation.messages.map((message) => message.content)].join(' ').toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export const isChatLibrary = (value: unknown): value is ChatLibrary => {
  if (!isRecord(value) || !Array.isArray(value.conversations)) return false;
  const ids = new Set<string>();
  for (const conversation of value.conversations) {
    if (!isRecord(conversation) || !isId(conversation.id) || ids.has(conversation.id) ||
        typeof conversation.title !== 'string' || !conversation.title.trim() ||
        !isDate(conversation.createdAt) || !isDate(conversation.updatedAt) || !Array.isArray(conversation.messages)) return false;
    ids.add(conversation.id);
    const messageIds = new Set<string>();
    for (const message of conversation.messages) {
      if (!isRecord(message) || !isId(message.id) || messageIds.has(message.id) || message.role !== 'user' ||
          typeof message.content !== 'string' || !message.content.trim() || !isDate(message.createdAt)) return false;
      messageIds.add(message.id);
    }
  }
  return value.activeConversationId === null || (isId(value.activeConversationId) && ids.has(value.activeConversationId));
};
