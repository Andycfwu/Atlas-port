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
