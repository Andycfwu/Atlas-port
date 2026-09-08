import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { chatColors as c } from '../chat/chat.theme';

export const MemoryFieldFocus = createContext<(target: number | null) => void>(() => {});

export function MemoryButton({ children, onPress, disabled = false, secondary = false }: { children: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, (disabled || pressed) && s.dim]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{children}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const reveal = useContext(MemoryFieldFocus);
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...props} onFocus={event => { reveal(event.nativeEvent.target); props.onFocus?.(event); }} onBlur={event => { reveal(null); props.onBlur?.(event); }} style={[s.input, props.multiline && s.multiline, props.style]} /></View>;
}
export function Panel({ children }: { children: ReactNode }) { return <View style={s.card}>{children}</View>; }
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background }, content: { padding: 20, paddingBottom: 32, gap: 16, width: '100%', maxWidth: 700, alignSelf: 'center' },
  title: { color: c.ink, fontSize: 27, lineHeight: 33, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { color: c.muted, fontSize: 15, lineHeight: 23 }, heading: { color: c.ink, fontSize: 19, lineHeight: 26, fontWeight: '700' },
  eyebrow: { color: c.orange, fontSize: 12, lineHeight: 18, fontWeight: '700', letterSpacing: 0.8 },
  body: { color: c.ink, fontSize: 15, lineHeight: 24 }, muted: { color: c.muted, fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: c.surface, borderRadius: 18, borderColor: c.border, borderWidth: 1, padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, grow: { flex: 1 },
  button: { minHeight: 48, borderRadius: 13, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: c.orange, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: c.surface, fontSize: 15, lineHeight: 22, fontWeight: '700' }, secondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, secondaryText: { color: c.ink }, dim: { opacity: 0.5 },
  field: { gap: 7 }, label: { color: c.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.surface, color: c.ink, fontSize: 16, lineHeight: 23 },
  multiline: { minHeight: 150, textAlignVertical: 'top' }, error: { padding: 15, gap: 10, backgroundColor: c.orangeSoft, borderRadius: 13 }, errorText: { color: c.orange, fontSize: 14, lineHeight: 21 },
  chip: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, justifyContent: 'center', backgroundColor: c.surface }, chipActive: { borderColor: c.orange, backgroundColor: c.orangeSoft }, chipText: { color: c.orange, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 3 }, quote: { backgroundColor: '#FFE0C6' },
});
