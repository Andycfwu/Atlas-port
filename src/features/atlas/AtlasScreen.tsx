import { useRef } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LineIcon, type IconName } from '../../components/LineIcon';
import { AtlasMark } from '../chat/AtlasMark';
import { useChats } from '../chat/ChatProvider';
import { ATLAS_DISCONNECTED_MESSAGE, MAX_MESSAGE_LENGTH } from '../chat/chat.model';
import { chatColors as c } from '../chat/chat.theme';

const suggestions: { label: string; prompt: string; icon: IconName; color: string; background: string }[] = [
  { label: 'Find It', prompt: 'What’s changed in my market this month?', icon: 'pin', color: c.orange, background: c.orangeSoft },
  { label: 'Plan It', prompt: 'How should I price my next spec?', icon: 'plan', color: c.sand, background: c.sandSoft },
  { label: 'Sell It', prompt: 'Build me a sales playbook for my newest community', icon: 'trend', color: c.sage, background: c.sageSoft },
];

export function AtlasScreen({ keyboardVisible = false }: { keyboardVisible?: boolean }) {
  const { activeConversationId, conversations, draft, ready, store } = useChats();
  const conversation = conversations.find((item) => item.id === activeConversationId);
  const messages = conversation?.messages ?? [];
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const canSend = ready && draft.trim().length > 0;

  return (
    <View style={styles.screen}>
      <FlatList
        key={activeConversationId ?? 'welcome'} ref={list} data={messages} keyExtractor={(item) => item.id}
        style={styles.list} contentContainerStyle={[styles.content, !messages.length && styles.welcomeContent]}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (messages.length) list.current?.scrollToEnd({ animated: true }); }}
        onLayout={() => { if (messages.length) list.current?.scrollToEnd({ animated: false }); }}
        ListEmptyComponent={
          <View>
            <View style={[styles.hero, height < 740 && styles.compactHero]}>
              <AtlasMark />
              <Text accessibilityRole="header" style={styles.greeting}>Welcome to Atlas</Text>
              <Text style={styles.subtitle}>A little clarity for your next move.</Text>
            </View>
            <Text style={styles.eyebrow}>WHERE WOULD YOU LIKE TO START?</Text>
            <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`${suggestion.label}: ${suggestion.prompt}`}
                  accessibilityHint="Adds this question to the composer. You can edit it before sending."
                  key={suggestion.label} onPress={() => { store.setDraft(suggestion.prompt); input.current?.focus(); }}
                  style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                  <View style={[styles.suggestionIcon, { backgroundColor: suggestion.background }]}><LineIcon name={suggestion.icon} color={suggestion.color} /></View>
                  <View style={styles.suggestionCopy}><Text style={styles.suggestionLabel}>{suggestion.label}</Text><Text style={styles.prompt}>{suggestion.prompt}</Text></View>
                  <LineIcon name="arrow" color="#9AA0AC" />
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListHeaderComponent={messages.length ? <Text style={styles.conversationNote}>SAVED ON THIS DEVICE</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.exchange}>
            <Text style={styles.messageLabel}>You</Text>
            <View style={styles.bubble}><Text selectable style={styles.message}>{item.content}</Text></View>
            <View style={styles.status}><View style={styles.statusDot} /><Text accessibilityLiveRegion="polite" style={styles.statusText}>{ATLAS_DISCONNECTED_MESSAGE}</Text></View>
          </View>
        )}
      />
      <View style={[styles.composerArea, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12) }]}>
        <View style={styles.composerWidth}>
          <View style={styles.composer}>
            <TextInput ref={input} accessibilityLabel="Ask Atlas" editable={ready} placeholder={ready ? 'Ask Atlas…' : 'Loading chats…'} placeholderTextColor={c.muted}
              multiline maxLength={MAX_MESSAGE_LENGTH} onChangeText={store.setDraft} style={styles.input} value={draft} textAlignVertical="top" />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !canSend }} disabled={!canSend}
              onPress={() => { if (store.sendMessage()) Keyboard.dismiss(); }} style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && styles.pressed]}>
              <Text style={[styles.sendLabel, !canSend && styles.sendLabelDisabled]}>Send</Text>
            </Pressable>
          </View>
          <Text style={styles.composerNote}>Atlas isn’t connected yet · Chats stay on this device</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background }, list: { flex: 1 },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 20, paddingBottom: 28 },
  welcomeContent: { flexGrow: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', paddingTop: 14, paddingBottom: 34 }, compactHero: { paddingTop: 0, paddingBottom: 24 },
  greeting: { marginTop: 22, fontSize: 29, fontWeight: '700', color: c.ink, letterSpacing: -1, textAlign: 'center' },
  subtitle: { marginTop: 9, color: c.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '700', color: c.muted, letterSpacing: 1.3, marginBottom: 13 }, suggestions: { gap: 10 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 17, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: 16, minHeight: 94 },
  suggestionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, suggestionCopy: { flex: 1, gap: 5 },
  suggestionLabel: { color: c.ink, fontSize: 14, fontWeight: '700' }, prompt: { color: c.muted, fontSize: 14, lineHeight: 20 }, pressed: { opacity: 0.65 },
  conversationNote: { textAlign: 'center', color: c.muted, fontSize: 10, letterSpacing: 1.2, marginVertical: 12 }, exchange: { paddingTop: 22 },
  messageLabel: { color: c.muted, fontWeight: '600', fontSize: 12, alignSelf: 'flex-end', marginBottom: 8 },
  bubble: { backgroundColor: c.orangeSoft, borderWidth: 1, borderColor: '#F0DACA', borderRadius: 19, borderTopRightRadius: 5, padding: 16, alignSelf: 'flex-end', maxWidth: '94%' },
  message: { color: c.ink, fontSize: 16, lineHeight: 24 }, status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, paddingHorizontal: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.mark }, statusText: { color: c.muted, fontSize: 13, lineHeight: 20, flex: 1 },
  composerArea: { paddingTop: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.background },
  composerWidth: { width: '100%', maxWidth: 620, alignSelf: 'center' },
  composer: { borderWidth: 1, borderColor: '#D9DBE0', borderRadius: 21, padding: 6, paddingLeft: 15, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.surface },
  input: { flex: 1, minHeight: 46, maxHeight: 140, paddingTop: 12, paddingBottom: 11, paddingRight: 10, fontSize: 16, lineHeight: 23, color: c.ink },
  send: { minWidth: 64, minHeight: 46, borderRadius: 15, backgroundColor: c.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 10 },
  sendDisabled: { backgroundColor: '#F3E4DA' }, sendLabel: { color: c.surface, fontSize: 14, fontWeight: '700' }, sendLabelDisabled: { color: '#8D7363' },
  composerNote: { color: c.muted, fontSize: 10, textAlign: 'center', marginTop: 9, lineHeight: 15 },
});
