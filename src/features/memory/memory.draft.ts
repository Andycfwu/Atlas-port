import { Directory, File, Paths } from 'expo-file-system';
import { emptyDraft, MAX_TRANSCRIPT_CHARS } from './memory.intake';
import type { IntakeDraft } from './memory.types';

const valid = (value: unknown): value is IntakeDraft => {
  const v = value as IntakeDraft | null;
  return Boolean(v && ['title', 'date', 'participantsText', 'originalTranscript'].every(k => typeof v[k as keyof IntakeDraft] === 'string') && v.originalTranscript.length <= MAX_TRANSCRIPT_CHARS);
};
// Independent from chat/recording files. Alternate slots retain the last good draft.
export function createIntakeDraftRepository() {
  let revision = 0, loaded = false;
  const dir = () => new Directory(Paths.document, 'atlas-meeting-intake');
  return {
    load(): IntakeDraft {
      const snapshots: { revision: number; draft: IntakeDraft }[] = [];
      let failures = 0;
      for (const slot of [0, 1]) {
        const file = new File(dir(), `draft-${slot}.json`);
        if (!file.exists) continue;
        try {
          const value = JSON.parse(file.textSync());
          if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !valid(value.draft)) throw new Error('Invalid draft');
          snapshots.push(value);
        } catch { failures += 1; }
      }
      const newest = snapshots.sort((a, b) => b.revision - a.revision)[0];
      if (!newest && failures) throw new Error('The saved intake draft could not be read. Its files have been kept.');
      revision = newest?.revision ?? 0; loaded = true;
      return newest?.draft ?? emptyDraft();
    },
    save(draft: IntakeDraft) {
      if (!loaded || !valid(draft)) throw new Error('The intake draft has not loaded or is invalid.');
      const directory = dir(); directory.create({ intermediates: true, idempotent: true });
      const next = revision + 1;
      new File(directory, `draft-${next % 2}.json`).write(JSON.stringify({ revision: next, draft }));
      revision = next;
    },
  };
}
