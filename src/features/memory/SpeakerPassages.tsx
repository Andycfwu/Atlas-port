import { Text, View } from 'react-native';
import type { TranscriptSegment, TranscriptSpeaker } from './memory.types';
import { s } from './memory.ui';
const colors = ['#A44318', '#245DA2', '#297452', '#824B92', '#846321', '#8D4058'];
export const audioTime = (ms: number) => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`;
export function SpeakerPassages({ original, segments, speakers }: { original: string; segments: TranscriptSegment[]; speakers: TranscriptSpeaker[] }) {
  return <View style={{ gap: 14 }}>{segments.map(segment => {
    const index = speakers.findIndex(speaker => speaker.id === segment.speakerId), speaker = speakers[index];
    const color = index < 0 ? '#59616D' : colors[index % colors.length];
    const overlaps = segment.audio && segments.some(other => other.id !== segment.id && other.audio && other.audio.startMs < segment.audio!.endMs && other.audio.endMs > segment.audio!.startMs);
    return <View key={segment.id} style={{ borderLeftWidth: 3, borderLeftColor: color, paddingLeft: 12, gap: 5 }}>
      <Text style={[s.label, { color }]}>{speaker ? `${speaker.label}${speaker.nameConfirmation ? ` · ${speaker.nameConfirmation.name} (user confirmed)` : ''}` : segment.attributionStatus === 'overlap' ? 'Overlapping / ambiguous voices' : 'Unknown speaker'}</Text>
      <Text style={s.muted}>{segment.audio ? `${audioTime(segment.audio.startMs)}–${audioTime(segment.audio.endMs)}` : 'Timing not supplied'}{overlaps ? ' · Timing overlaps another passage' : ''}{segment.providerOverlap === true ? ' · Provider marked overlap' : ''}</Text>
      <Text selectable style={s.body}>{original.slice(segment.start, segment.end)}</Text>
    </View>;
  })}</View>;
}
