import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveRuntimeStatus } from './live-transcription-runtime.mjs';

test('health distinguishes loaded backend code from edits requiring a restart', () => {
  let revision = 'old-backend';
  const status = createLiveRuntimeStatus(() => revision);
  const started = status();
  assert.equal(started.restartRequired, false);
  revision = 'fixed-backend';
  assert.deepEqual(status(), { ...started, sourceRevision: revision, restartRequired: true });
  const restarted = createLiveRuntimeStatus(() => revision)();
  assert.equal(restarted.loadedRevision, revision);
  assert.equal(restarted.restartRequired, false);
});

test('missing source cannot silently report a current backend', () => {
  let missing = false;
  const status = createLiveRuntimeStatus(() => {
    if (missing) throw new Error('file unavailable');
    return 'loaded-backend';
  });
  missing = true;
  assert.equal(status().restartRequired, true);
  assert.equal(status().sourceRevision, null);
  assert.equal(status().loadedRevision, 'loaded-backend');
});
