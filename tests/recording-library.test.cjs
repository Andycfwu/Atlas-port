const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./load-typescript.cjs');
const service = load('src/features/recorder/recorder.service.ts');
const transcripts = load('src/features/recorder/recorder.transcripts.ts');
const library = load('src/features/recorder/recording-library.model.ts', {
  './recorder.service': service, './recorder.transcripts': transcripts,
});
const recording = (id, extra = {}) => ({ id, title: 'Client walkthrough', createdAt: '2026-09-10T14:00:00Z',
  transcript: null, transcriptionStatus: 'none', durationMillis: 12000, ...extra });

test('library search covers titles, localized dates, live drafts and every saved transcript version without changing source data', () => {
  const source = recording('all-sources', { liveTranscript: { text: 'Kitchen island' },
    postTranscripts: [{ text: 'First revision: patio' }, { text: 'Second revision: garden' }],
    diarizedTranscripts: [{ providerText: 'Speaker A: inspection' }] });
  const snapshot = JSON.stringify(source);
  for (const query of [' WALKTHROUGH  kitchen ', 'patio', 'garden', 'inspection', '2026-09-10', service.formatRecordingDate(source.createdAt)]) {
    assert.deepEqual(library.filterRecordings([source], query, 'all').map(item => item.id), ['all-sources']);
  }
  assert.equal(library.filterRecordings([source], 'kitchen garage', 'all').length, 0);
  assert.equal(JSON.stringify(source), snapshot);
});

test('text and attention filters combine with search, keep legacy/partial text discoverable, and never imply failed audio', () => {
  const records = [recording('legacy', { transcript: 'Fence' }),
    recording('partial', { liveTranscript: { text: 'Fence', status: 'failed' } }),
    recording('retry', { transcriptionStatus: 'failed', transcript: 'Fence' }),
    recording('speakers', { diarization: { status: 'failed' } }),
    recording('blank', { transcript: '  ', liveTranscript: { text: ' ' } }), recording('audio')];
  assert.deepEqual(library.filterRecordings(records, '', 'transcript').map(item => item.id), ['legacy', 'partial', 'retry']);
  assert.deepEqual(library.filterRecordings(records, 'fence', 'attention').map(item => item.id), ['retry']);
  assert.equal(library.filterRecordings(records, '', 'attention').length, 2);
  assert.equal(library.recordingTranscriptLabel(records[2]), 'Transcription failed');
  assert.equal(library.recordingTranscriptLabel(records[1]), 'Live draft saved');
  assert.equal(library.recordingTranscriptLabel(records[5]), 'Audio saved');
});

test('cleared filters restore all recordings newest first without reordering the provider library', () => {
  const records = [recording('old', { createdAt: '2026-09-08T14:00:00Z' }), recording('new')];
  assert.deepEqual(library.filterRecordings(records, '  ', 'all').map(item => item.id), ['new', 'old']);
  assert.deepEqual(records.map(item => item.id), ['old', 'new']);
});

const jsx = (type, props) => ({ type, props });
const native = { StyleSheet: { create: value => value }, View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator' };
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
const { RecordingControls } = load('src/features/recorder/components/RecordingControls.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
  '../../../config/theme': { colors: {} }, './RecordingTimer': { RecordingTimer: 'Timer' },
  './RecordingVisualizer': { RecordingVisualizer: 'Visualizer' },
});

test('capture controls retain the start/stop callback and disable microphone transitions while starting or saving', () => {
  let calls = 0;
  const render = (phase, isRecording) => walk(RecordingControls({ phase, isRecording, durationMillis: 12000, metering: -20, onToggle: async () => { calls++; } })).find(node => node.type === 'Pressable');
  const ready = render('idle', false);
  assert.equal(ready.props.accessibilityLabel, 'Start Recording');
  ready.props.onPress();
  const active = render('recording', true);
  assert.equal(active.props.accessibilityLabel, 'Stop & Save');
  active.props.onPress();
  assert.equal(calls, 2);
  for (const [phase, active] of [['starting', false], ['stopping', true]]) {
    const button = render(phase, active);
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.busy, true);
  }
});

test('opening another recording while audio plays keeps its Play label and selects that recording on press', () => {
  const selected = recording('selected');
  let played = null;
  const { RecordingDetailScreen } = load('src/features/recorder/RecordingDetailScreen.tsx', {
    './diarization/DiarizationPanel': { DiarizationPanel: 'DiarizationPanel' },
    react: { useState: value => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    '../../components/Screen': { Screen: 'Screen' }, '../../config/theme': { colors: {} },
    './recorder.transcripts': transcripts,
    './components/RecordingScrubber': { RecordingScrubber: 'Scrubber' },
    './components/RecordingTranscript': { RecordingTranscript: 'Transcript' },
    './components/RenameRecordingModal': { RenameRecordingModal: 'Rename' },
    './RecorderProvider': { useRecorder: () => ({ recordings: [selected] }) },
    './recording-sharing.service': {}, './recorder.service': service,
    './playback': { useRecordingPlayer: () => ({ activeRecordingId: 'another-recording', isPlaying: true,
      isLoaded: true, phase: 'playing', playRecording: async value => { played = value; } }) },
  });
  const nodes = walk(RecordingDetailScreen({ recordingId: selected.id, onBack() {}, onDeleted() {}, onMeetingMemory() {} }));
  assert.ok(nodes.some(node => node.type === 'Text' && node.props.children === 'Play recording'));
  assert.ok(!nodes.some(node => node.type === 'Text' && node.props.children === 'Pause'));
  const playButton = nodes.find(node => node.type === 'Pressable' && walk(node).some(child => child.props?.children === 'Play recording'));
  playButton.props.onPress();
  assert.equal(played, selected);
});
