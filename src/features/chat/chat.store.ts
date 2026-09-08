import { appendMessage, createConversation, MAX_MESSAGE_LENGTH, type ChatLibrary } from './chat.model';
import type { ChatRepository } from './chat.storage';

interface ChatState extends ChatLibrary {
  ready: boolean;
  error: string | null;
  drafts: Record<string, string>;
}

/** Local actions only. No API client, audio ownership, or assistant messages.
 * The existing atlas/atlas.service.ts is the future backend boundary.
 */
export const createChatStore = (repository: ChatRepository) => {
  let state: ChatState = { conversations: [], activeConversationId: null, ready: false, error: null, drafts: {} };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const commit = (library: ChatLibrary) => {
    if (!state.ready) return false;
    try {
      repository.save(library);
      publish({ ...library, error: null });
      return true;
    } catch {
      publish({ error: 'Couldn’t save this change on your device. Your message is still here. Please try again.' });
      return false;
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate() {
      try {
        const { library, recovered } = repository.load();
        publish({ ...library, ready: true, error: recovered ? 'Recovered the last readable chat history. The most recent change may be missing.' : null });
      } catch (error) {
        publish({ ready: false, error: error instanceof Error ? error.message : 'Chat history could not be loaded.' });
      }
    },
    setDraft(text: string) {
      publish({ drafts: { ...state.drafts, [state.activeConversationId ?? 'new']: text } });
    },
    newChat() {
      const conversation = createConversation();
      return commit({ conversations: [conversation, ...state.conversations], activeConversationId: conversation.id });
    },
    openChat(id: string) {
      if (!state.conversations.some((conversation) => conversation.id === id)) return false;
      return commit({ conversations: state.conversations, activeConversationId: id });
    },
    sendMessage() {
      const key = state.activeConversationId ?? 'new';
      const content = state.drafts[key]?.trim();
      if (!content || !state.ready) return false;
      if (content.length > MAX_MESSAGE_LENGTH) {
        publish({ error: 'This message is too long. Shorten it and try again.' });
        return false;
      }
      const existing = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
      const conversation = appendMessage(existing ?? createConversation(), content);
      const saved = commit({
        conversations: [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)],
        activeConversationId: conversation.id,
      });
      if (saved) publish({ drafts: { ...state.drafts, [key]: '', [conversation.id]: '' } });
      return saved;
    },
  };
};
