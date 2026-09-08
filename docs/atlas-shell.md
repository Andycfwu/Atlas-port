# Atlas mobile shell — September 8, 2026

## Milestone

The desktop reference is adapted to a light, orange-accented phone shell. The
header opens an animated left menu. The welcome screen includes a compass mark,
a neutral greeting, and all three requested prompts. Selecting a prompt fills
and focuses the composer without sending. Send trims input, saves a user message,
and shows **Atlas isn’t connected yet.** Empty or whitespace-only drafts cannot
be sent. No assistant messages are fabricated and no chat network calls occur.

New Chat creates a local conversation. Search Chats matches both titles and all
message contents, case-insensitively. Chat History and the menu’s recent chats
reopen conversations. File Browser and Profile/Settings show Coming soon.
Attachments are not offered as an active composer control.

The root uses safe-area context and KeyboardAvoidingView. The welcome content,
messages, history, placeholder screens, and drawer scroll. The multiline
composer grows to a bounded height and scrolls internally for longer text. Core
controls have at least 44-point touch targets and accessible names/states. The
drawer respects reduced-motion settings and Android Back closes the modal;
subsequent Back returns from recording detail, or from another destination to
Atlas. Drafts stay associated with their conversation during in-app navigation.

## Code boundaries

- `src/features/chat/chat.model.ts`: local conversation/message types, validation,
  title derivation, and search.
- `src/features/chat/chat.storage.ts`: Expo FileSystem repository, two alternating
  versioned snapshots under `Paths.document/atlas-chats/`.
- `src/features/chat/chat.store.ts`: local actions; commit before clearing the
  composer. Failed writes retain the draft and show an actionable notice.
- `src/features/chat/ChatProvider.tsx`: React subscription adapter.
- `src/features/atlas/AtlasScreen.tsx`: welcome, suggestions, messages, composer.
- `src/features/chat/ChatHistoryScreen.tsx`: local history and search.
- `src/navigation/AppNavigator.tsx`, `AppDrawer.tsx`: existing state-based
  navigation pattern, replacing the two-tab bar.
- `src/features/atlas/atlas.service.ts`: **future, currently unused** Atlas backend
  boundary. Supply an authenticated RealTorch API client and add a submission
  layer when integrating. Assistant/delivery state needs an explicit schema
  migration; networking should not own local persistence or recorder state.

Sent messages, deliberately created empty chats, and current chat selection
persist across restarts. Unsent drafts are session-only. Data is local to the
app installation; uninstalling removes it. No authentication, cloud sync,
backend integration, publishing, or store submission is included.

## Transcription preservation

The existing `AudioSessionProvider`, `AnimalSoundProvider`, `RecorderProvider`,
and `RecordingPlayerProvider` remain mounted in their original order, above the
navigation. `ChatProvider` is nested beneath them. Recorder capture, the repaired
iOS startup ordering, PCM streaming, socket lifecycle, live draft state,
post-stop transcription, file validation, metadata, and playback code are
unchanged. The separate Live Transcription destination renders the existing
RecorderScreen and RecordingDetailScreen. Screen safe-area edges now delegate
the top/side insets to the shared shell and retain their own bottom inset.
A recording banner returns to the recorder while visiting another destination.

## Brand assets

The RealTorch torch is reused from `assets/realtorch-torch.png`. The accompanying
text wordmark and the native compass in `AtlasMark.tsx` are placeholders. Needed:

- Official Atlas compass/logo, preferably a transparent high-resolution asset.
- Official complete RealTorch wordmark for an exact logo match.

The previous demo portrait and animal sound files remain for compatibility with
the existing provider graph, but are not presented as chat responses. The
screenshot’s personal identity and email were not copied.

## Run

From the project root, use Node 22.13+:

```sh
npm install
npm start
```

Open the project in a compatible Expo 57 client, or build locally:

```sh
npm run ios
npm run android
```

Chat works without a backend or environment variables. Existing transcription
requires its previous backend configuration; see the README’s transcription
setup. A native development build is required for meaningful background capture
checks. This milestone has no new package or native configuration requirements.

## Automated verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 55 passed (8 new chat tests, 47 existing recorder/transcription tests).
- iOS and Android production JavaScript exports: passed, retained in ignored
  `.expo/atlas-shell-export` and `.expo/atlas-shell-android-export`.
- `git diff --check`: passed.
- `npx expo install --check`: reports existing patch-version drift: Expo
  57.0.16 → 57.0.21, expo-asset 57.0.14 → 57.0.16, expo-dev-client 57.0.15 →
  57.0.18, expo-file-system 57.0.5 → 57.0.6, expo-sharing 57.0.15 → 57.0.18,
  React Native 0.86.2 → 0.86.3, and eslint-config-expo 57.0.1 → 57.0.2.
  Dependencies were not changed as part of the shell milestone.

The chat tests execute the production model, store, and repository with only the
native filesystem boundary mocked. They verify whitespace guarding, draft-only
selection, creation, repeated sends, full-text search, reopening through fresh
store/repository instances, failed/partial writes, snapshot recovery, invalid
history protection, and drafts across conversation switches. Existing tests
cover PCM ownership, startup ordering, live success/failure, draft publication,
completion/draining, recorder independence, and durable recording recovery.
These mocks do not prove physical microphone or live upstream behavior.

## Native verification

A local iOS development build succeeded on iPhone 17 Pro / iOS 26.5 (zero
errors, two native build warnings). The following were exercised in
Simulator and inspected through native accessibility state and screenshots:

- Welcome layout and all three suggestion prompts; each populated the composer
  without creating a message.
- Empty and whitespace-only Send disabled states.
- New Chat from both header and drawer; empty composer on a fresh conversation.
- Sending Find It and Plan It messages, clearing the composer, and showing only
  the user text plus the explicit disconnected status.
- Drawer branding, all destinations, recent conversations, and Coming soon
  states for File Browser and Profile/Settings.
- Chat History listing and case-insensitive Search Chats; searching MARKET
  returned the matching chat, which reopened correctly.
- Native filesystem snapshots contained two conversations and only user roles.
  Terminating and relaunching the app restored the selected chat, its message,
  and both history entries.
- Visible iOS software keyboard: composer and Send remained above it. An
  eight-line draft was capped in height with internal scrolling available.
  Dismissing the keyboard restored the full-height layout.
- The dedicated Live Transcription screen rendered the original recorder and
  saved-library controls, independently of chat navigation.

No AI service was called. The simulator build/Metro run used an empty
process-scoped `EXPO_PUBLIC_API_URL`; `.env.local` was not changed. The test
Metro server was stopped after verification; use `npm start` to run with the
project’s normal environment.

**Native recording limitation:** after allowing the app’s microphone permission,
Simulator remained at Opening Microphone / Starting. Logs reached the existing
native recorder’s `PREPARE_STARTED` event without a subsequent ready event;
Simulator also emitted a CoreFoundation audio factory warning. The app was
terminated to end the stalled check. This is not a successful microphone,
recording, or live-transcription test, and its root cause was not established in
this milestone. Recorder implementation files and audio configuration are
unchanged. The previous physical-iPhone pass is documented in
`docs/live-transcription-verification.md`; it is historical evidence, not a new
acceptance result for this shell.

Still required on a physical device with the existing transcription backend:
record speech, navigate to chat while recording, return to the live draft,
Stop & Save, play the complete recording, confirm final transcription, restart,
and verify persistence. Live upstream words, capture continuity across menu
navigation, stop/save/playback, background/lock behavior, physical keyboard
variants, VoiceOver/TalkBack, larger accessibility text sizes, smaller phones,
and Android native interaction were not verified in this session. Android
JavaScript bundling and the existing isolated lifecycle tests passed.

The simulator contains only the shell QA chats created during these checks.
No App Store/archive/distribution build was created or published.


## References checked before implementation

- [Exact Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo 57 FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)
- [Expo 57 safe-area context](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/)
- [Expo 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
- [React Native KeyboardAvoidingView](https://reactnative.dev/docs/keyboardavoidingview)
