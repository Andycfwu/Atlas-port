import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { appConfig } from '../../../config/app.config';
import { colors } from '../../../config/theme';
import { createApiClient } from '../../../services/api';
import type { LiveProvider } from './live-speakers.model';

export function RecordingModeChoice({ provider, onSelect, disabled }: { provider: LiveProvider; onSelect: (provider: LiveProvider) => void; disabled: boolean }) {
  const [availability, setAvailability] = useState({ available: false, message: 'Checking experimental mode availability…' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let active = true;
    async function check() {
      try {
        if (!appConfig.apiUrl) throw new Error('No backend');
        const status = await createApiClient({ baseUrl: appConfig.apiUrl }).request<{ liveSpeakerLabels?: { available: boolean; message: string; configurationVersion: string } }>('/health', { signal: controller.signal });
        if (!active) return;
        const capability = status.liveSpeakerLabels;
        setAvailability(capability?.configurationVersion === 'atlas-deepgram-live-v1' && typeof capability.message === 'string'
          ? { available: capability.available === true, message: capability.message }
          : { available: false, message: 'Live speaker labels are unavailable. The backend needs the experimental streaming update.' });
      } catch {
        if (active) setAvailability({ available: false, message: 'Cannot check live speaker labels. Check the backend connection, then refresh. Local audio recording remains available.' });
      } finally { clearTimeout(timer); }
    }
    void check();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  const liveDisabled = process.env.EXPO_PUBLIC_LIVE_TRANSCRIPTION_MODE === 'off';
  return <View style={{ gap: 9, marginVertical: 14 }}>
    <Text style={{ color: colors.ink, fontWeight: '700' }}>Recording mode</Text>
    {(['openai', 'deepgram'] as const).map(mode => {
      const unavailable = disabled || (mode === 'deepgram' && (!availability.available || liveDisabled));
      return <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: provider === mode, disabled: unavailable }} disabled={unavailable}
        onPress={() => onSelect(mode)} style={{ minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1,
          borderColor: provider === mode ? colors.brand : colors.border, backgroundColor: colors.surface, opacity: unavailable ? 0.6 : 1 }}>
        <Text style={{ color: colors.ink }}>{provider === mode ? '● ' : '○ '}{mode === 'openai' ? 'Existing live transcription' : 'Live speaker labels — experimental'}</Text>
      </Pressable>;
    })}
    <Text style={{ color: colors.mutedInk, fontSize: 12, lineHeight: 18 }}>{liveDisabled ? 'Live streaming is disabled in this build.' : availability.message}</Text>
    {provider === 'deepgram' ? <Text style={{ color: colors.ink, fontSize: 12, lineHeight: 18 }}>This mode sends microphone audio through the backend to Deepgram. Labels are estimates. OpenAI live and automatic saved-audio transcription will not run for this recording.</Text> : null}
    {!disabled ? <Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.brand }}>Refresh availability</Text></Pressable> : <Text style={{ color: colors.mutedInk }}>Mode is fixed until this recording is saved.</Text>}
  </View>;
}
