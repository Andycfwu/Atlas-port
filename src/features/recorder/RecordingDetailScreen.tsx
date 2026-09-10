import { DiarizationPanel } from './diarization/DiarizationPanel';
import type { DiarizedTranscript } from './diarization/diarization.types';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import { colors } from '../../config/theme';
import type { SavedRecording } from './recorder.types';
import { preferredTranscript } from './recorder.transcripts';
import { RecordingScrubber } from './components/RecordingScrubber';
import { RecordingTranscript } from './components/RecordingTranscript';
import { RenameRecordingModal } from './components/RenameRecordingModal';
import { useRecorder } from './RecorderProvider';
import {
  RecordingSharingUnavailableError,
  shareRecording,
} from './recording-sharing.service';
import { formatDuration, formatRecordingDate } from './recorder.service';
import { useRecordingPlayer } from './playback';

interface RecordingDetailScreenProps {
  onBack: () => void;
  onDeleted: () => void;
  onMeetingMemory: (recording: SavedRecording, diarized?: DiarizedTranscript) => void;
  recordingId: string;
}

export function RecordingDetailScreen({
  onBack,
  onDeleted,
  onMeetingMemory,
  recordingId,
}: RecordingDetailScreenProps) {
  const {
    deleteRecording,
    recordings,
    renameRecording,
    transcribeRecording,
    persistDiarization,
  } = useRecorder();
  const {
    activeRecordingId,
    clearPlaybackError,
    currentTimeMillis,
    durationMillis,
    errorMessage: playbackError,
    isBuffering,
    isLoaded,
    isMicrophoneActive,
    isPlaying,
    pause,
    phase,
    playRecording,
    resume,
    seekTo,
  } = useRecordingPlayer();
  const [isRenameVisible, setIsRenameVisible] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const recording = recordings.find((item) => item.id === recordingId);

  if (!recording) {
    return (
      <Screen>
        <View style={styles.missingContainer}>
          <Text style={styles.eyebrow}>LOCAL LIBRARY</Text>
          <Text style={styles.missingTitle}>Recording unavailable</Text>
          <Text style={styles.missingBody}>
            This recording is no longer present in the local library.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <Text style={styles.primaryActionText}>Back to recordings</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const isActive = activeRecordingId === recording.id;
  const isThisPlaying = isActive && isPlaying;
  const displayedPosition = isActive ? currentTimeMillis : 0;
  const displayedDuration = isActive ? durationMillis : recording.durationMillis;
  const isPlayerReady = isActive && isLoaded && displayedDuration > 0;
  const playerLabel = isThisPlaying
    ? 'Pause'
    : phase === 'loading' && isActive
      ? 'Loading…'
      : phase === 'completed' && isActive
        ? 'Play again'
        : isActive
          ? 'Resume'
          : 'Play recording';
  const statusLabel = !isActive
    ? 'READY TO PLAY'
    : phase === 'playing'
      ? 'PLAYING RECORDING'
      : phase === 'loading' || isBuffering
        ? 'LOADING AUDIO'
        : phase === 'completed'
          ? 'PLAYBACK COMPLETE'
          : phase === 'error'
            ? 'PLAYBACK NEEDS ATTENTION'
            : 'PLAYBACK PAUSED';

  const handlePlaybackToggle = async () => {
    setActionError(null);

    if (isActive && isPlaying) {
      await pause();
    } else if (isActive && phase !== 'error') {
      await resume();
    } else {
      await playRecording(recording);
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    setActionError(null);

    try {
      await shareRecording(recording);
    } catch (error) {
      if (__DEV__) {
        console.error('[Recorder] Share/export failed.', {
          error,
          recordingId: recording.id,
          uri: recording.uri,
        });
      }

      setActionError(
        error instanceof RecordingSharingUnavailableError
          ? 'Sharing is not available on this device.'
          : 'The recording could not be shared.',
      );
    } finally {
      setIsSharing(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete recording?',
      `“${recording.title}” and its audio file will be permanently removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Recording',
          style: 'destructive',
          onPress: () => {
            setIsDeleting(true);
            setActionError(null);

            void deleteRecording(recording.id)
              .then(onDeleted)
              .catch((error: unknown) => {
                if (__DEV__) {
                  console.error('[Recorder] Confirmed deletion failed.', {
                    error,
                    recordingId: recording.id,
                    uri: recording.uri,
                  });
                }
                setActionError('The recording could not be fully deleted.');
              })
              .finally(() => setIsDeleting(false));
          },
        },
      ],
    );
  };

  const visibleError = actionError ?? playbackError;

  return (
    <Screen>
      <ScrollView
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Back to saved recordings"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.backAction, pressed && styles.pressed]}
        >
          <Text style={styles.backMark}>‹</Text>
          <Text style={styles.backText}>Saved Recordings</Text>
        </Pressable>

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>REALTORCH · SAVED AUDIO</Text>
          <Text style={styles.title}>{recording.title}</Text>
          <View style={styles.metadataRow}>
            <Text style={styles.metadata}>{formatRecordingDate(recording.createdAt)}</Text>
            <View style={styles.metadataDot} />
            <Text style={styles.metadata}>{formatDuration(recording.durationMillis)}</Text>
          </View>
        </View>

        <View style={styles.playerCard}>
          <View style={styles.playerStatusRow}>
            <View style={[styles.statusDot, isThisPlaying && styles.playingDot]} />
            <Text style={[styles.statusText, isThisPlaying && styles.playingText]}>
              {statusLabel}
            </Text>
          </View>

          <RecordingScrubber
            disabled={!isPlayerReady || isMicrophoneActive || phase === 'loading'}
            durationMillis={Math.max(0, displayedDuration)}
            onSeek={seekTo}
            positionMillis={Math.max(0, displayedPosition)}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy: phase === 'loading' && isActive,
              disabled: isMicrophoneActive,
            }}
            disabled={isMicrophoneActive}
            onPress={() => {
              void handlePlaybackToggle();
            }}
            style={({ pressed }) => [
              styles.playbackAction,
              pressed && styles.playbackPressed,
              isMicrophoneActive && styles.disabled,
            ]}
          >
            <View style={styles.playbackMark}>
              {phase === 'loading' && isActive ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : isThisPlaying ? (
                <View style={styles.pauseMark}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              ) : (
                <View style={styles.playMark} />
              )}
            </View>
            <Text style={styles.playbackLabel}>{playerLabel}</Text>
            <Text style={styles.playbackMeta}>LOCAL FILE</Text>
          </Pressable>

          {isMicrophoneActive ? (
            <Text style={styles.playerNote}>
              Saved recording playback is unavailable while the microphone is active.
            </Text>
          ) : null}
        </View>

        {visibleError ? (
          <View style={styles.errorCard}>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Recording notice</Text>
              <Text style={styles.errorBody}>{visibleError}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setActionError(null);
                clearPlaybackError();
              }}
              style={({ pressed }) => [styles.dismissAction, pressed && styles.pressed]}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actionSection}>
          <Text style={styles.sectionEyebrow}>PUT THIS CONVERSATION TO WORK</Text>
          <View style={styles.actionList}>
            <DetailAction featured label="Add to Meeting Memory" meta={preferredTranscript(recording)?.source === 'live' ? 'Review the live draft, then explore next steps' : 'Review the transcript, then explore next steps'} onPress={() => {
              if (preferredTranscript(recording) || recording.liveSpeakerTranscripts?.some(v => v.text.trim())) { void pause(); onMeetingMemory(recording); }
              else setActionError('No transcript is available yet. Use Transcribe Recording below, then add it to Meeting Memory.');
            }} />
            <DetailAction
              label="Rename"
              meta="Give this conversation a useful name"
              onPress={() => setIsRenameVisible(true)}
            />
            <DetailAction
              busy={isSharing}
              label="Share / Export"
              meta="Share the original audio file"
              onPress={() => {
                void handleShare();
              }}
            />
            <DetailAction
              busy={isDeleting}
              destructive
              label="Delete Recording"
              meta="Permanently remove this recording"
              onPress={confirmDelete}
            />
          </View>
        </View>

        <View style={{ marginTop: 20 }}><DiarizationPanel recording={recording} onPersist={persistDiarization} onUse={version => { void pause(); onMeetingMemory(recording, version); }} /></View>

        <RecordingTranscript
          onTranscribe={force => transcribeRecording(recording.id, force)}
          recording={recording}
        />
      </ScrollView>

      {isRenameVisible ? (
        <RenameRecordingModal
          currentTitle={recording.title}
          onClose={() => setIsRenameVisible(false)}
          onSave={(title) => renameRecording(recording.id, title)}
        />
      ) : null}
    </Screen>
  );
}

interface DetailActionProps {
  featured?: boolean;
  busy?: boolean;
  destructive?: boolean;
  label: string;
  meta: string;
  onPress: () => void;
}

function DetailAction({
  featured = false,
  busy = false,
  destructive = false,
  label,
  meta,
  onPress,
}: DetailActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.detailAction,
        featured && styles.featuredAction,
        destructive && styles.destructiveAction,
        pressed && styles.pressed,
        busy && styles.disabled,
      ]}
    >
      <View style={[styles.actionMonogram, destructive && styles.destructiveMonogram]}>
        {busy ? (
          <ActivityIndicator color={destructive ? colors.danger : colors.brand} size="small" />
        ) : (
          <Text style={[styles.actionMonogramText, destructive && styles.destructiveText]}>
            {destructive ? '×' : '→'}
          </Text>
        )}
      </View>
      <View style={styles.detailActionCopy}>
        <Text style={[styles.detailActionLabel, destructive && styles.destructiveText]}>
          {label}
        </Text>
        <Text style={styles.detailActionMeta}>{meta}</Text>
      </View>
      <Text style={[styles.actionChevron, destructive && styles.destructiveText]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
  },
  backAction: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 0,
    minHeight: 44,
    paddingVertical: 5,
    paddingRight: 10,
  },
  backMark: {
    color: colors.accent,
    fontSize: 25,
    fontWeight: '500',
    lineHeight: 22,
  },
  backText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  intro: {
    marginTop: 18,
    marginBottom: 18,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 7,
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 35,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metadata: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '600',
  },
  metadataDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  playerCard: {
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.035,
    shadowRadius: 22,
    elevation: 4,
  },
  playerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  playingDot: {
    backgroundColor: colors.brand,
  },
  statusText: {
    color: colors.mutedInk,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  playingText: {
    color: colors.brand,
  },
  playbackAction: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    paddingHorizontal: 11,
    borderRadius: 18,
    backgroundColor: colors.brand,
  },
  playbackPressed: {
    backgroundColor: colors.brandPressed,
    transform: [{ scale: 0.99 }],
  },
  playbackMark: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  playMark: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.white,
  },
  pauseMark: {
    flexDirection: 'row',
    gap: 4,
  },
  pauseBar: {
    width: 4,
    height: 15,
    borderRadius: 2,
    backgroundColor: colors.white,
  },
  playbackLabel: {
    flex: 1,
    marginLeft: 12,
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
  playbackMeta: {
    marginRight: 4,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  playerNote: {
    marginTop: 11,
    color: colors.mutedInk,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 14,
    borderRadius: 17,
    backgroundColor: colors.dangerSoft,
  },
  errorCopy: {
    flex: 1,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  errorBody: {
    marginTop: 3,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
  },
  dismissAction: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: colors.surface,
  },
  dismissText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
  },
  actionSection: {
    marginTop: 26,
  },
  sectionEyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  actionList: {
    gap: 9,
    marginTop: 11,
  },
  detailAction: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  destructiveAction: {
    borderColor: colors.dangerSoft,
  },
  featuredAction: { backgroundColor: colors.sageSoft, borderColor: '#D9E5D9' },
  actionMonogram: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.subduedSurface,
  },
  destructiveMonogram: {
    backgroundColor: colors.dangerSoft,
  },
  actionMonogramText: {
    color: colors.brand,
    fontSize: 17,
    fontWeight: '900',
  },
  detailActionCopy: {
    flex: 1,
    marginLeft: 11,
  },
  detailActionLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  detailActionMeta: {
    marginTop: 3,
    color: colors.mutedInk,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '400',
  },
  actionChevron: {
    marginRight: 3,
    color: colors.accent,
    fontSize: 23,
    fontWeight: '500',
  },
  destructiveText: {
    color: colors.danger,
  },
  missingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  missingTitle: {
    marginTop: 8,
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
  },
  missingBody: {
    maxWidth: 320,
    marginTop: 8,
    color: colors.mutedInk,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryAction: {
    marginTop: 18,
    paddingHorizontal: 17,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: colors.brand,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.68,
  },
  disabled: {
    opacity: 0.48,
  },
});
