# Atlas brand asset status

The mobile chat shell uses a native compass placeholder in
`src/features/chat/AtlasMark.tsx`; an official Atlas compass/logo asset is needed.
The drawer reuses `assets/realtorch-torch.png` alongside a text wordmark. Supply
an official full RealTorch wordmark (ideally transparent PNG or a vector source)
for an exact brand match. No screenshot portrait, name, or email is used.

The files below belong to the earlier sound demo. They remain for compatibility
with its retained audio provider, but are not shown or played as chat responses.

# Atlas demo assets

The proof of concept expects these local, bundled files:

- `founder.png` — Atlas avatar image
- `moo.mp3` — Moo quick response
- `oink.mp3` — Oink quick response
- `rooster.mp3` — Rooster quick response
- `bark.mp3` — Bark quick response

The active assets are registered in `src/features/atlas/atlas.assets.ts`. The
original Rooster and Bark WAV files are retained under `source/` but are not
referenced by Metro or included in the active bundled asset set. The avatar
component provides a monogram fallback for rendering errors, and the shared
sound provider surfaces playback errors without affecting the recorder.
