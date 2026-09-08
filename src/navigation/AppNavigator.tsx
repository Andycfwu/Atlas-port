import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LineIcon } from '../components/LineIcon';
import { AtlasScreen } from '../features/atlas';
import { AtlasMark } from '../features/chat/AtlasMark';
import { ChatHistoryScreen } from '../features/chat/ChatHistoryScreen';
import { useChats } from '../features/chat/ChatProvider';
import { chatColors as c } from '../features/chat/chat.theme';
import { RecorderScreen, RecordingDetailScreen, useRecorder } from '../features/recorder';
import { AppDrawer, type AppDestination } from './AppDrawer';

const titles: Record<AppDestination, string> = {
  atlas: 'Atlas', search: 'Search Chats', history: 'Chat History', files: 'File Browser', recorder: 'Live Transcription', settings: 'Profile/Settings',
};

export function AppNavigator() {
  const [destination, setDestination] = useState<AppDestination>('atlas');
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const { isRecording } = useRecorder();
  const { store, error, ready } = useChats();

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (destination === 'recorder' && selectedRecordingId) { setSelectedRecordingId(null); return true; }
      if (destination !== 'atlas') { setDestination('atlas'); return true; }
      return false;
    });
    return () => back.remove();
  }, [destination, selectedRecordingId]);

  const navigate = (next: AppDestination) => { Keyboard.dismiss(); setMenuOpen(false); setDestination(next); };
  const newChat = () => { if (store.newChat()) navigate('atlas'); else setMenuOpen(false); };
  const openChat = (id: string) => { if (store.openChat(id)) navigate('atlas'); else setMenuOpen(false); };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open menu" accessibilityState={{ expanded: menuOpen }} onPress={() => { Keyboard.dismiss(); setMenuOpen(true); }} style={styles.headerButton}><LineIcon name="menu" color={c.ink} /></Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{titles[destination]}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="New chat" disabled={!ready} accessibilityState={{ disabled: !ready }} onPress={newChat} style={styles.headerButton}><LineIcon name="plus" color={ready ? c.muted : c.border} /></Pressable>
        </View>
        {error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.noticeText}>{error}</Text>{!ready ? <Pressable accessibilityRole="button" onPress={store.hydrate} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable> : null}</View> : null}
        {isRecording && destination !== 'recorder' ? <Pressable accessibilityRole="button" accessibilityLabel="Recording in progress. Return to Live Transcription" onPress={() => { setSelectedRecordingId(null); navigate('recorder'); }} style={styles.recording}><View style={styles.recordingDot} /><Text style={styles.recordingText}>Recording in progress</Text><Text style={styles.recordingText}>Return →</Text></Pressable> : null}
        <View style={styles.destination}>
          {destination === 'atlas' ? <AtlasScreen keyboardVisible={keyboardVisible} />
            : destination === 'search' || destination === 'history' ? <ChatHistoryScreen key={destination} search={destination === 'search'} onOpenChat={openChat} onNewChat={newChat} />
              : destination === 'recorder' ? selectedRecordingId
                ? <RecordingDetailScreen onBack={() => setSelectedRecordingId(null)} onDeleted={() => setSelectedRecordingId(null)} recordingId={selectedRecordingId} />
                : <RecorderScreen onOpenRecording={setSelectedRecordingId} />
                : <SafeAreaView edges={['bottom']} style={styles.destination}><ScrollView contentContainerStyle={styles.comingSoon}>
                  <AtlasMark /><Text style={styles.soonEyebrow}>COMING SOON</Text><Text accessibilityRole="header" style={styles.soonTitle}>{titles[destination]}</Text>
                  <Text style={styles.soonBody}>{destination === 'files' ? 'A home for the files behind your next move. File browsing and attachments aren’t available yet.' : 'Your Atlas preferences will live here. Profiles and account sign-in aren’t available yet.'}</Text>
                  <Pressable accessibilityRole="button" onPress={() => navigate('atlas')} style={styles.backToChat}><Text style={styles.backToChatText}>Back to Atlas</Text></Pressable>
                </ScrollView></SafeAreaView>}
        </View>
        <AppDrawer visible={menuOpen} destination={destination} isRecording={isRecording} onClose={() => setMenuOpen(false)} onNavigate={navigate} onNewChat={newChat} onOpenChat={openChat} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background }, destination: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 60, borderBottomWidth: 1, borderBottomColor: c.border },
  headerButton: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, headerTitle: { flex: 1, color: c.ink, fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  notice: { padding: 12, backgroundColor: c.orangeSoft, flexDirection: 'row', alignItems: 'center', gap: 12 }, noticeText: { flex: 1, color: c.orange, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }, retryText: { color: c.orange, fontWeight: '700' },
  recording: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44, paddingHorizontal: 20, backgroundColor: '#F7E9E6' }, recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A33C30' }, recordingText: { color: '#913C30', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  comingSoon: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30, width: '100%', maxWidth: 520, alignSelf: 'center' },
  soonEyebrow: { color: c.orange, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 25 }, soonTitle: { color: c.ink, fontSize: 28, fontWeight: '700', marginTop: 12, textAlign: 'center' }, soonBody: { color: c.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 14 },
  backToChat: { minHeight: 48, paddingHorizontal: 20, justifyContent: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.surface, marginTop: 26 }, backToChatText: { color: c.ink, fontSize: 15, fontWeight: '600' },
});
