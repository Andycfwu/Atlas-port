import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LineIcon } from '../../components/LineIcon';
import { useChats } from './ChatProvider';
import { searchConversations } from './chat.model';
import { chatColors as c } from './chat.theme';

export function ChatHistoryScreen({ search, onOpenChat, onNewChat }: { search: boolean; onOpenChat: (id: string) => void; onNewChat: () => void }) {
  const [query, setQuery] = useState('');
  const { conversations, activeConversationId, ready } = useChats();
  const results = searchConversations(conversations, query);
  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>{search ? 'Find a conversation' : 'Your conversations'}</Text>
        <Text style={styles.subtitle}>Pick up where you left off. Saved on this device.</Text>
        {search ? (
          <View style={styles.search}>
            <LineIcon name="search" />
            <TextInput accessibilityLabel="Search chat history" autoFocus placeholder="Search titles and messages…" placeholderTextColor={c.muted} onChangeText={setQuery} value={query} style={styles.input} returnKeyType="search" />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.clear}><LineIcon name="close" /></Pressable> : null}
          </View>
        ) : null}
        <Text accessibilityLiveRegion="polite" style={styles.count}>{results.length} {results.length === 1 ? 'conversation' : 'conversations'}</Text>
        <FlatList data={results} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.rows}
          ListEmptyComponent={
            <View style={styles.empty}>
              <LineIcon name={query ? 'search' : 'chat'} />
              <Text style={styles.emptyTitle}>{!ready ? 'Loading chat history…' : query ? 'No matching chats' : 'Your next idea starts here'}</Text>
              <Text style={styles.emptyText}>{query ? 'Try another word from a title or message.' : 'Start a conversation and it will appear here.'}</Text>
              {!query && ready ? <Pressable accessibilityRole="button" onPress={onNewChat} style={styles.newChat}><Text style={styles.newChatText}>New chat</Text></Pressable> : null}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open chat: ${item.title}`} accessibilityState={{ selected: activeConversationId === item.id }} onPress={() => onOpenChat(item.id)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}>
              <View style={styles.rowHead}><Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text><LineIcon name="arrow" /></View>
              <Text numberOfLines={2} style={styles.preview}>{item.messages.at(-1)?.content ?? 'No messages yet'}</Text>
              <Text style={styles.date}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {item.messages.length} {item.messages.length === 1 ? 'message' : 'messages'}</Text>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 26 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.8, color: c.ink },
  subtitle: { fontSize: 14, lineHeight: 21, color: c.muted, marginTop: 8, marginBottom: 22 },
  search: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, borderWidth: 1, borderColor: c.border, borderRadius: 15, backgroundColor: c.surface, gap: 9 },
  input: { flex: 1, minHeight: 52, color: c.ink, fontSize: 15 }, clear: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  count: { color: c.muted, fontSize: 12, marginTop: 20, marginBottom: 12 }, rows: { gap: 10, paddingBottom: 24 },
  row: { padding: 17, borderWidth: 1, borderColor: c.border, borderRadius: 16, backgroundColor: c.surface },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rowTitle: { color: c.ink, fontSize: 16, fontWeight: '600', flex: 1, lineHeight: 22 },
  preview: { color: c.muted, fontSize: 14, lineHeight: 21, marginTop: 9 }, date: { color: c.muted, fontSize: 11, marginTop: 14 },
  empty: { alignItems: 'center', paddingVertical: 35, gap: 12 }, emptyTitle: { color: c.ink, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: c.muted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  newChat: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: c.orange, borderRadius: 14, marginTop: 8 }, newChatText: { color: c.surface, fontWeight: '700', fontSize: 15 },
});
