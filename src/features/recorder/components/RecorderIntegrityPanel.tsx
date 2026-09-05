import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import type {
  RecorderIntegrityResult,
  RecorderIntegrityTestKind,
} from '../recorder.integrity.types';
import { formatDuration } from '../recorder.service';

interface RecorderIntegrityPanelProps {
  onRunProduction: () => Promise<void>;
  onRunRaw: () => Promise<void>;
  onSaveToLibrary: (sessionId: string) => Promise<void>;
  results: RecorderIntegrityResult[];
  runningTest: Exclude<RecorderIntegrityTestKind, 'normal'> | null;
}

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) {
    return 'Unavailable';
  }

  return `${bytes.toLocaleString()} bytes (${(bytes / 1_024).toFixed(1)} KB)`;
};

const formatMeasuredDuration = (durationMillis: number | null): string =>
  durationMillis === null
    ? 'Unavailable'
    : `${formatDuration(durationMillis)} (${durationMillis} ms)`;

const testTitle = (testKind: RecorderIntegrityTestKind): string => {
  if (testKind === 'production') {
    return '10-Second Production Test';
  }

  if (testKind === 'raw') {
    return '10-Second Raw Test';
  }

  return 'Normal Stop & Save';
};

export function RecorderIntegrityPanel({
  onRunProduction,
  onRunRaw,
  onSaveToLibrary,
  results,
  runningTest,
}: RecorderIntegrityPanelProps) {
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const isRunning = runningTest !== null;

  const saveResult = async (sessionId: string) => {
    setSavingSessionId(sessionId);

    try {
      await onSaveToLibrary(sessionId);
    } finally {
      setSavingSessionId(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>DEVELOPMENT INTEGRITY MODE</Text>
      <Text style={styles.title}>Recorder integrity tests</Text>
      <Text style={styles.body}>
        Raw keeps the exact native file in Documents. Production uses the same
        move, destination validation, recordings.json write, and library update
        as Stop &amp; Save.
      </Text>

      <View style={styles.actions}>
        <IntegrityButton
          disabled={isRunning}
          isRunning={runningTest === 'raw'}
          label="Run 10-Second Raw Test"
          onPress={onRunRaw}
        />
        <IntegrityButton
          disabled={isRunning}
          isRunning={runningTest === 'production'}
          label="Run 10-Second Production Test"
          onPress={onRunProduction}
        />
      </View>

      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((result) => {
            const isSaving = savingSessionId === result.sessionId;
            const canSave =
              result.passed && result.sourceValidation?.passed &&
              result.libraryRecordingId === null &&
              !isRunning;

            return (
              <View key={result.sessionId} style={styles.resultCard}>
                <View style={styles.resultHeading}>
                  <View style={styles.resultCopy}>
                    <Text style={styles.resultTitle}>{testTitle(result.testKind)}</Text>
                    <Text style={styles.sessionId}>{result.sessionId}</Text>
                  </View>
                  <Text style={[styles.resultState, !result.passed && styles.failed]}>
                    {result.passed ? 'PASS' : 'FAIL'}
                  </Text>
                </View>

                <DiagnosticValue
                  label="Expected"
                  value={formatMeasuredDuration(result.expectedDurationMillis)}
                />
                <DiagnosticValue
                  label="Native before Stop"
                  value={formatMeasuredDuration(result.nativeDurationBeforeStopMillis)}
                />
                <DiagnosticValue
                  label="Playable file"
                  value={formatMeasuredDuration(result.playerDurationMillis)}
                />
                <DiagnosticValue label="File size" value={formatBytes(result.fileSize)} />
                <DiagnosticValue
                  label="Source URI"
                  selectable
                  value={result.sourceUri ?? 'Unavailable'}
                />
                <DiagnosticValue
                  label="Destination URI"
                  selectable
                  value={result.destinationUri ?? 'Not moved'}
                />

                {result.failedChecks.length > 0 ? (
                  <View style={styles.failedChecks}>
                    <Text style={styles.failedChecksTitle}>FAILED CHECKS</Text>
                    {result.failedChecks.map((check, index) => (
                      <View key={`${check.id}-${index}`} style={styles.failedCheck}>
                        <Text style={styles.failedCheckLabel}>{check.label}</Text>
                        <Text style={styles.failedCheckDetail}>
                          Expected: {check.expected}{'\n'}Actual: {check.actual}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {result.error ? (
                  <Text selectable style={styles.errorDetail}>
                    {result.error}
                  </Text>
                ) : null}

                {result.libraryRecordingId ? (
                  <Text style={styles.savedState}>SAVED TO LOCAL LIBRARY</Text>
                ) : canSave ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={() => {
                      void saveResult(result.sessionId);
                    }}
                    style={({ pressed }) => [
                      styles.saveButton,
                      pressed && styles.pressed,
                      isSaving && styles.disabled,
                    ]}
                  >
                    {isSaving ? (
                      <ActivityIndicator color={colors.brand} size="small" />
                    ) : null}
                    <Text style={styles.saveButtonLabel}>
                      {isSaving
                        ? 'Saving test recording…'
                        : 'Save Test Recording to Library'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface IntegrityButtonProps {
  disabled: boolean;
  isRunning: boolean;
  label: string;
  onPress: () => Promise<void>;
}

function IntegrityButton({
  disabled,
  isRunning,
  label,
  onPress,
}: IntegrityButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: isRunning, disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {isRunning ? <ActivityIndicator color={colors.white} size="small" /> : null}
      <Text style={styles.buttonLabel}>{isRunning ? 'Test recording…' : label}</Text>
    </Pressable>
  );
}

interface DiagnosticValueProps {
  label: string;
  selectable?: boolean;
  value: string;
}

function DiagnosticValue({ label, selectable = false, value }: DiagnosticValueProps) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text selectable={selectable} style={styles.valueText}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  title: {
    marginTop: 6,
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    marginTop: 7,
    color: colors.mutedInk,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    marginTop: 14,
    gap: 9,
  },
  button: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.56,
  },
  buttonLabel: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  results: {
    marginTop: 16,
    gap: 10,
  },
  resultCard: {
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resultHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 9,
  },
  resultCopy: {
    flex: 1,
  },
  resultTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  sessionId: {
    marginTop: 2,
    color: colors.mutedInk,
    fontSize: 9,
  },
  resultState: {
    marginLeft: 10,
    color: colors.brand,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  failed: {
    color: colors.danger,
  },
  valueRow: {
    marginTop: 7,
  },
  valueLabel: {
    color: colors.mutedInk,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  valueText: {
    marginTop: 2,
    color: colors.ink,
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  failedChecks: {
    marginTop: 11,
    padding: 11,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  failedChecksTitle: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  failedCheck: {
    marginTop: 8,
  },
  failedCheckLabel: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '800',
  },
  failedCheckDetail: {
    marginTop: 2,
    color: colors.mutedInk,
    fontSize: 9,
    lineHeight: 14,
  },
  errorDetail: {
    marginTop: 9,
    color: colors.danger,
    fontSize: 9,
    lineHeight: 14,
  },
  saveButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  saveButtonLabel: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: '800',
  },
  savedState: {
    marginTop: 12,
    color: colors.brand,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
});
