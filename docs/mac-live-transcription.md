# Physical iPhone / Mac transcription repair — September 8, 2026

## Confirmed failure and cause

The app was still using `http://10.78.248.103:8787` while the MacBook's current
Wi-Fi IPv4 address was `10.0.0.104`. Requests to the former address timed out.
Metro and the transcription server use different ports and connections;
successfully opening the Expo app did not establish backend connectivity.

The user reported Expo Go displaying “Live transcript unavailable. After saving,
use the recording's Transcribe action.” Current iPhone traces isolate the failure
past microphone preparation and native capture, at the backend connection:

- `rec-mtswkohp-8kg6n4` prepared and confirmed native recording on the iPhone.
- `atlas-tx-mtswkoow-0001-mz1pz6md` used the stale host, live mode `on`, and 24 kHz
  PCM. It received 100 native buffers / 479,478 bytes over 9.89 seconds, then hit
  `LIVE_CONNECTION_TIMEOUT` with no live ready/draft event.
- Local save still passed strict validation: 13,591 ms native versus 13,629 ms
  playable, with library metadata saved. The saved-file transcription request
  also targeted the stale host.

The current backend was already running from this repository's `server/`, bound
on `0.0.0.0:8787`. Both localhost and the current LAN `/health` responded. Runtime
loaded/source revisions matched (`1c030cff7cff07e1`) and `restartRequired` was
false. The Mac firewall reported disabled; its settings were not changed.
The user confirmed iPhone Safari could load `http://10.0.0.104:8787/health` and
see `"ok": true`. Server key presence was checked without displaying its value.

## Baseline and shell audit

The clean starting checkout was `b559f88` (mobile shell). Comparison with
`22f867d` (Fix recording integrity and foreground live transcription) showed no
changes in recorder capture, live networking, audio providers, backend code,
package manifests/lockfile, or native app configuration before this repair.

There remains exactly one AudioSessionProvider, AnimalSoundProvider,
RecorderProvider, and RecordingPlayerProvider, in their original order, above
navigation. ChatProvider is below them. Moving through the menu replaces screen
UI without recreating the microphone owner or live network hook. Chat sends
have no audio-session or transcription calls. There was no evidence that the
shell caused the observed endpoint timeout. The earlier simulator preparation
stall is a separate, unconfirmed simulator problem; current physical-device
traces prove that this iPhone completes preparation and captures PCM.

## Changes

- Updated only `EXPO_PUBLIC_API_URL` in ignored `.env.local` to the current Mac
  LAN endpoint. Preserved the server environment, credentials, recordings,
  shell, audio ownership, and native configuration.
- Restarted Metro with `npx expo start --go --lan --clear` so the phone loaded the
  new inlined public URL. Kept the already-current backend running.
- Added failure-code-based live error guidance, including the configured host
  and steps to check the backend/current address/phone network. Only URL host
  and port are shown; credentials, paths, and queries are excluded.
- Kept failed live sessions failed after Stop and preserved existing drafts.
  Errors accompanying a draft now use readable 13-point text instead of a tiny
  disclaimer. No new audio, transcript-content, or credential diagnostics were
  introduced.
- Corrected missing native stream metadata to report capture unavailable rather
  than incorrectly reporting missing backend configuration.
- Bumped the diagnostic client revision to `live-network-guidance-4` to confirm
  the phone has the updated JS. The existing 10-second connection and 15-second
  finalization timeouts remain in force. Native capture ordering is unchanged.

## Verification

TypeScript, ESLint, and all **58 automated tests** passed. Three new regressions
cover the stale-endpoint timeout's actionable/sticky failure, endpoint privacy,
and correct missing-stream-metadata classification. These tests do not replace
physical-device acceptance.

After the configuration repair, the physical iPhone trace
`atlas-tx-mtsx0r3c-0001-wmnr6xts` used `10.0.0.104:8787` and the new client revision:

- Native preparation finished in approximately 98 ms.
- Native recording confirmed, then mono PCM at 24 kHz delivered its first buffer.
- Backend ready at 17:00:15.475 UTC; first UI draft published at 17:00:16.275 UTC,
  about 3.05 seconds after the request and before Stop.
- 167 native buffers / 801,212 bytes over 16.606 seconds.
- Live completion succeeded. Stop/save validated 16,757 ms native versus
  16,763 ms playable and saved recording `mtsx14la-bsu13a`.
- Saved-file trace `atlas-tx-mtsx15ca-0002-q9zs26xo` completed and persisted its
  authoritative transcript.

The user confirmed that live words appeared before Stop, the recording saved,
and playback was complete, including the first and last spoken words. They
also observed different but correct wording between live and saved transcripts
while two people spoke. These are separate transcription passes; the live
text is provisional and the saved-file transcript is the final version.

The user also confirmed a second recording continued displaying live words after
navigating to Atlas through the menu and returning to Live Transcription. It
saved successfully, and playback was complete through the navigation portion.

Lock/app switch and development-build acceptance are tracked as the guided tests
progress. No claim about background behavior is inferred from file duration
alone.

## Commands on this MacBook

From the repository root (`/Users/andywu/Desktop/Codex/atlas-port`):

```sh
npm install
npm --prefix server install
```

Keep the existing `server/.env` with `OPENAI_API_KEY` and `PORT=8787`. Do not copy
the key into the client environment. In terminal 1:

```sh
npm run backend
```

In terminal 2, use the current Mac Wi-Fi address. This process-scoped override
avoids reusing an address saved on a different computer or network:

```sh
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --clear
```

At the time of this repair the app URL is `exp://10.0.0.104:8081`; Safari can open
`http://10.0.0.104:8081/_expo/loading` and choose Expo Go. Keep the phone and Mac
on the same Wi-Fi. The phone should also be able to load
`http://10.0.0.104:8787/health`. Re-evaluate the address when moving networks;
`localhost` on the phone refers to the phone, not the Mac. Do not expose this
unauthenticated development backend to the public internet.

If using the saved `.env.local` instead, its `EXPO_PUBLIC_API_URL` must contain
the current Mac LAN URL, then `npx expo start --go --lan --clear` is sufficient.
Starting another server on an occupied port is unnecessary; the repair session
leaves the backend and Metro available for the device checks.

## Native/background testing

Foreground Expo Go does not need a rebuild for this repair. The installed
RealTorch Atlas development app is a separate app container; Expo Go recordings
are not migrated or deleted by installing a development build. Background
recording acceptance must use a native build containing `UIBackgroundModes:
[audio]` and the existing expo-audio configuration. Live draft networking is
intentionally paused when the app becomes inactive/backgrounded; local audio is
intended to continue. Returning to the app does not resume the interrupted live
session automatically. Stop/save and a new recording start a fresh live session.

A signed Debug build from the current checkout succeeded with Xcode after
enabling automatic provisioning updates. The initial attempt had failed because
this Mac had no development profile for `com.realtorch.atlas`. No source, native
dependency, bundle identifier, or signing-team changes were required. The built
app's `Info.plist` contains the `audio` background mode.

Installation on the paired iPhone succeeded. The Mac's first launch attempt
was rejected by iOS with a signing/entitlement/trust restriction. Local code
signature verification passed, and the embedded development profile includes
this iPhone's UDID. The profile expires September 15, 2026 at 17:05 UTC; rebuild
and reinstall when it expires. The device's trust prompt and native background
acceptance still require user confirmation.

Exact build command from the repository root:

```sh
xcodebuild -workspace ios/RealTorchAtlas.xcworkspace \
  -scheme RealTorchAtlas -configuration Debug \
  -destination 'generic/platform=iOS' \
  -derivedDataPath .expo/mac-device-build \
  -allowProvisioningUpdates build
```

Install over the existing development app (preserves its container; do not
uninstall it) with the paired iPhone unlocked:

```sh
xcrun devicectl device install app \
  --device 62B36FC2-B22B-52A5-9532-56B150EAF220 \
  .expo/mac-device-build/Build/Products/Debug-iphoneos/RealTorchAtlas.app
```

For future development-app sessions, start Metro with:

```sh
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --dev-client --lan --clear
```

Open **RealTorch Atlas** on the iPhone and select the server at the Mac's current
LAN address. Keep the same backend command running. During this repair session,
the existing Metro process can also serve the development client without
interrupting it or deleting the Expo Go installation.

If iOS reports **Untrusted Developer**, go to **Settings → General → VPN & Device
Management**, select the developer entry for this app, and tap **Trust** before
opening RealTorch Atlas again. See [Apple's developer trust instructions](https://help.apple.com/xcode/mac/current/en.lproj/dev96a12fb84.html).

Remaining guided native tests (one at a time):

1. Confirm the separate RealTorch Atlas app opens, rather than Expo Go.
2. Start recording and confirm live words, lock the phone while continuing to
   speak for about 10 seconds, unlock, then stop/save and play it. Expect live
   draft status to remain paused after locking; audio should include the locked
   interval.
3. Start a fresh recording, confirm live words, switch to a silent app such as
   Settings while continuing to speak for about 10 seconds, return, then
   stop/save and play it. Expect the same live pause and continuous saved audio.

These native tests are pending; a signed build and successful installation do
not establish microphone or background acceptance.
