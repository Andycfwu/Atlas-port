import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../../../config/theme';
import { postSources } from '../recorder.transcripts';
import type { SavedRecording } from '../recorder.types';

interface RecordingTranscriptProps {
  onTranscribe: (force?: boolean) => Promise<boolean>;
  recording: SavedRecording;
}

export function RecordingTranscript({
  onTranscribe,
  recording,
}: RecordingTranscriptProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [technicalDetailsVisible, setTechnicalDetailsVisible] = useState(false);

  const requestTranscription = async () => {
    if (isRequesting || recording.transcriptionStatus === 'transcribing') {
      return;
    }

    setIsRequesting(true);
    setMessage(null);

    try {
      await onTranscribe(true);
    } finally {
      setIsRequesting(false);
    }
  };

  const copyTranscript = async () => {
    if (!recording.transcript) {
      return;
    }

    setMessage(null);

    try {
      await Clipboard.setStringAsync(recording.transcript);
      setMessage('Transcript copied.');
    } catch (error) {
      if (__DEV__) {
        console.warn('[RecorderTranscription] Copy failed.', error);
      }

      setMessage('The transcript could not be copied.');
    }
  };

  const isTranscribing =
    recording.transcriptionStatus === 'transcribing' || isRequesting;
  const hasTranscript =
    recording.transcriptionStatus === 'complete' &&
    Boolean(recording.transcript);
  const failure = recording.latestTranscriptionFailure;
  const statusBadge = isTranscribing
    ? 'PROCESSING'
    : hasTranscript
      ? 'COMPLETE'
      : recording.transcriptionStatus === 'failed'
        ? 'RETRY'
        : 'READY';

  return (
    <><View style={styles.card}>
      <Text style={styles.eyebrow}>SAVED LIVE TRANSCRIPT</Text>
      <Text style={styles.emptyBody}>{recording.liveTranscript
        ? `Captured during recording · ${recording.liveTranscript.model} · ${recording.liveTranscript.status}`
        : 'No live transcript was saved for this recording. Older recordings cannot recover live text that was never stored; transcribe the saved audio instead.'}</Text>
      {recording.liveTranscript?.status !== 'completed' && recording.liveTranscript ? <Text style={styles.emptyBody}>Live capture was incomplete. Text received before it stopped is preserved. {recording.liveTranscript.errorMessage}</Text> : null}
      {recording.liveTranscript?.text ? <><ScrollView nestedScrollEnabled style={styles.transcriptScroll}><Text selectable style={styles.transcriptText}>{recording.liveTranscript.text}</Text></ScrollView>
        <TranscriptAction label="Copy live transcript" onPress={async () => { try { await Clipboard.setStringAsync(recording.liveTranscript!.text); setMessage('Transcript copied.'); } catch { setMessage('The transcript could not be copied.'); } }} />
      </> : null}
      <Text style={styles.emptyBody}>Live and saved-audio transcription are independent source versions. They may differ; Atlas keeps them separate and does not guess a merged transcript. Meeting Memory defaults to saved live text when available.</Text>
    </View><View style={styles.card}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>SAVED-AUDIO TRANSCRIPT</Text>
          <Text style={styles.title}>Post-recording text</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{statusBadge}</Text>
        </View>
      </View>

      {isTranscribing ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.brand} size="small" />
          <Text style={styles.emptyTitle}>Transcribing…</Text>
          <Text style={styles.emptyBody}>
            The recording is already saved locally. You can leave this screen.
          </Text>
        </View>
      ) : hasTranscript ? (
        <View style={styles.completeState}>
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator
            style={styles.transcriptScroll}
          >
            <Text selectable style={styles.transcriptText}>
              {recording.transcript}
            </Text>
          </ScrollView>
          <TranscriptAction label="Copy Transcript" onPress={copyTranscript} />
        </View>
      ) : recording.transcriptionStatus === 'failed' ? (
        <View style={styles.emptyState}>
          <View style={styles.mark}>
            <Text style={styles.markText}>T</Text>
          </View>
          <Text style={styles.emptyTitle}>Transcription needs attention</Text>
          <Text style={styles.emptyBody}>
            {failure?.userMessage ??
              'Atlas could not finish the transcript. The saved audio remains playable.'}
          </Text>
          <TranscriptAction
            label="Retry Transcription"
            onPress={requestTranscription}
          />
          {__DEV__ && failure ? (
            <View style={styles.technicalSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: technicalDetailsVisible }}
                onPress={() =>
                  setTechnicalDetailsVisible((current) => !current)
                }
                style={({ pressed }) => [
                  styles.technicalToggle,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.technicalToggleText}>
                  Technical details {technicalDetailsVisible ? '−' : '+'}
                </Text>
              </Pressable>
              {technicalDetailsVisible ? (
                <View style={styles.technicalDetails}>
                  <TechnicalDetail label="Code" value={failure.code} />
                  <TechnicalDetail label="Stage" value={failure.stage} />
                  <TechnicalDetail label="Trace ID" value={failure.traceId} />
                  <TechnicalDetail
                    label="HTTP status"
                    value={
                      failure.httpStatus === undefined
                        ? 'not available'
                        : String(failure.httpStatus)
                    }
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <View style={styles.mark}>
            <Text style={styles.markText}>T</Text>
          </View>
          <Text style={styles.emptyTitle}>Transcript not generated yet</Text>
          <Text style={styles.emptyBody}>
            Create a transcript from the saved local recording when you are ready.
          </Text>
          <TranscriptAction
            label="Transcribe Recording"
            onPress={requestTranscription}
          />
        </View>
      )}

      {recording.transcript && !hasTranscript ? <View style={styles.completeState}><Text style={styles.emptyBody}>Previous saved-audio result (preserved)</Text><Text selectable style={styles.transcriptText}>{recording.transcript}</Text></View> : null}
      {recording.transcriptionStatus === 'complete' && !isTranscribing ? <TranscriptAction label="Transcribe audio again (keeps previous)" onPress={requestTranscription} /> : null}
      {postSources(recording).map((version, index, all) => <View key={`${version.traceId}-${index}`}>
        <Text style={styles.emptyBody}>{index === all.length - 1 ? 'Latest' : 'Earlier'} saved-audio version · {version.model ?? 'Model not recorded'} · {version.savedAt ?? 'Date not recorded'}</Text>
        {index < all.length - 1 ? <ScrollView nestedScrollEnabled style={styles.transcriptScroll}><Text selectable style={styles.transcriptText}>{version.text}</Text></ScrollView> : null}
      </View>)}
      {message ? (
        <Text
          style={
            message === 'Transcript copied.'
              ? styles.successMessage
              : styles.errorMessage
          }
        >
          {message}
        </Text>
      ) : null}
    </View></>
  );
}

interface TechnicalDetailProps {
  label: string;
  value: string;
}

function TechnicalDetail({ label, value }: TechnicalDetailProps) {
  return (
    <View style={styles.technicalRow}>
      <Text style={styles.technicalLabel}>{label}</Text>
      <Text selectable style={styles.technicalValue}>
        {value}
      </Text>
    </View>
  );
}

interface TranscriptActionProps {
  label: string;
  onPress: () => Promise<void>;
}

function TranscriptAction({ label, onPress }: TranscriptActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 23,
    borderRadius: 17,
    backgroundColor: colors.canvas,
  },
  mark: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 13,
    backgroundColor: colors.brand,
  },
  markText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyTitle: {
    marginTop: 12,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyBody: {
    maxWidth: 330,
    marginTop: 7,
    color: colors.mutedInk,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  completeState: {
    marginTop: 17,
  },
  transcriptScroll: {
    maxHeight: 280,
    padding: 14,
    borderRadius: 15,
    backgroundColor: colors.canvas,
  },
  transcriptText: {
    paddingBottom: 14,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 22,
  },
  action: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 14,
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: colors.brand,
  },
  actionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  successMessage: {
    marginTop: 10,
    color: colors.brand,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    marginTop: 10,
    color: colors.danger,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  technicalSection: {
    alignSelf: 'stretch',
    marginTop: 12,
  },
  technicalToggle: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  technicalToggleText: {
    color: colors.mutedInk,
    fontSize: 10,
    fontWeight: '800',
  },
  technicalDetails: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  technicalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  technicalLabel: {
    color: colors.mutedInk,
    fontSize: 9,
    fontWeight: '800',
  },
  technicalValue: {
    flex: 1,
    color: colors.ink,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
});
