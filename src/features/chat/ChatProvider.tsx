import { createContext, type PropsWithChildren, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import { createChatRepository } from './chat.storage';
import { createChatStore } from './chat.store';

const ChatContext = createContext<ReturnType<typeof createChatStore> | null>(null);

export function ChatProvider({ children }: PropsWithChildren) {
  const [store] = useState(() => createChatStore(createChatRepository()));
  useEffect(() => { store.hydrate(); }, [store]);
  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

export const useChats = () => {
  const store = useContext(ChatContext);
  if (!store) throw new Error('useChats requires ChatProvider.');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, store, draft: state.drafts[state.activeConversationId ?? 'new'] ?? '' };
};
