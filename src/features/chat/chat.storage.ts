import { Directory, File, Paths } from 'expo-file-system';

import { isChatLibrary, type ChatLibrary } from './chat.model';

export interface ChatRepository {
  load(): { library: ChatLibrary; recovered: boolean };
  save(library: ChatLibrary): void;
}

interface Snapshot {
  version: 1;
  revision: number;
  library: ChatLibrary;
}

/** Uses the same native Documents API as recordings, in an independent directory.
 * Alternating snapshots keep the previous successful write if a write is interrupted.
 * Loading must succeed before mutation; unreadable history is never silently erased.
 */
export const createChatRepository = (): ChatRepository => {
  let revision = 0;
  let loaded = false;
  const directory = () => new Directory(Paths.document, 'atlas-chats');
  return {
    load() {
      loaded = false;
      const candidates: Snapshot[] = [];
      let invalid = 0;
      for (const slot of [0, 1]) {
        const file = new File(directory(), `history-${slot}.json`);
        if (!file.exists) continue;
        try {
          const snapshot = JSON.parse(file.textSync()) as Partial<Snapshot>;
          if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.revision) ||
              (snapshot.revision ?? 0) < 1 || !isChatLibrary(snapshot.library)) throw new Error('Invalid chat snapshot.');
          candidates.push(snapshot as Snapshot);
        } catch {
          invalid += 1;
        }
      }
      const latest = candidates.sort((a, b) => b.revision - a.revision)[0];
      if (!latest && invalid) throw new Error('Chat history could not be read. Your saved files have been kept. Try reopening the app.');
      revision = latest?.revision ?? 0;
      loaded = true;
      return {
        library: latest?.library ?? { conversations: [], activeConversationId: null },
        recovered: invalid > 0,
      };
    },
    save(library) {
      if (!loaded) throw new Error('Chat history has not loaded yet.');
      if (!isChatLibrary(library)) throw new Error('Invalid chat history.');
      const nextRevision = revision + 1;
      const folder = directory();
      folder.create({ idempotent: true, intermediates: true });
      new File(folder, `history-${nextRevision % 2}.json`).write(JSON.stringify({
        version: 1, revision: nextRevision, library,
      } satisfies Snapshot));
      revision = nextRevision;
    },
  };
};
