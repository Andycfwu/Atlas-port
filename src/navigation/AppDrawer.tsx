import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LineIcon, type IconName } from '../components/LineIcon';
import { AtlasMark, RealTorchWordmark } from '../features/chat/AtlasMark';
import { useChats } from '../features/chat/ChatProvider';
import { searchConversations } from '../features/chat/chat.model';
import { chatColors as c } from '../features/chat/chat.theme';

export type AppDestination = 'atlas' | 'search' | 'history' | 'files' | 'recorder' | 'settings';
const destinations: { id: AppDestination; label: string; icon: IconName; soon?: boolean }[] = [
  { id: 'search', label: 'Search Chats', icon: 'search' },
  { id: 'history', label: 'Chat History', icon: 'chat' },
  { id: 'files', label: 'File Browser', icon: 'folder', soon: true },
  { id: 'recorder', label: 'Live Transcription', icon: 'mic' },
  { id: 'settings', label: 'Profile/Settings', icon: 'profile', soon: true },
];

export function AppDrawer({ visible, destination, isRecording, onClose, onNavigate, onNewChat, onOpenChat }: {
  visible: boolean; destination: AppDestination; isRecording: boolean;
  onClose: () => void; onNavigate: (destination: AppDestination) => void;
  onNewChat: () => void; onOpenChat: (id: string) => void;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { conversations, ready } = useChats();
  const drawerWidth = Math.min(350, width - 36);
  useEffect(() => {
    if (!visible) { progress.setValue(0); return; }
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!cancelled) Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 0 : 220, useNativeDriver: true }).start();
    });
    return () => { cancelled = true; progress.stopAnimation(); };
  }, [visible, progress]);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={StyleSheet.absoluteFill}><Animated.View style={[styles.backdrop, { opacity: progress }]} /></Pressable>
        <Animated.View accessibilityViewIsModal onAccessibilityEscape={onClose} style={[styles.drawer, { width: drawerWidth, paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }] }]}>
          <View style={styles.brandRow}><RealTorchWordmark /><Pressable accessibilityRole="button" accessibilityLabel="Close navigation menu" onPress={onClose} style={styles.close}><LineIcon name="close" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={onNewChat} style={({ pressed }) => [styles.newChat, pressed && styles.pressed, !ready && styles.pressed]}><LineIcon name="plus" color={c.surface} /><Text style={styles.newChatLabel}>New Chat</Text></Pressable>
            <View style={styles.links}>{destinations.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: destination === item.id }} accessibilityLabel={`${item.label}${item.soon ? ', Coming soon' : ''}${item.id === 'recorder' && isRecording ? ', recording in progress' : ''}`} onPress={() => onNavigate(item.id)} style={({ pressed }) => [styles.link, destination === item.id && styles.active, pressed && styles.pressed]}>
                <LineIcon name={item.icon} color={destination === item.id ? c.orange : c.muted} />
                <View style={styles.linkCopy}><Text style={[styles.linkLabel, destination === item.id && { color: c.orange }]}>{item.label}</Text>{item.soon ? <Text style={styles.soon}>Coming soon</Text> : null}</View>
                {item.id === 'recorder' && isRecording ? <View style={styles.recordingDot} /> : null}
              </Pressable>
            ))}</View>
            <Text style={styles.eyebrow}>RECENT CHATS</Text>
            {searchConversations(conversations, '').slice(0, 4).map((conversation) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open chat: ${conversation.title}`} key={conversation.id} onPress={() => onOpenChat(conversation.id)} style={({ pressed }) => [styles.recent, pressed && styles.pressed]}>
                <Text numberOfLines={1} style={styles.recentTitle}>{conversation.title}</Text><Text style={styles.recentDate}>{new Date(conversation.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
              </Pressable>
            ))}
            {!conversations.length ? <Text style={styles.empty}>Your conversations will live here.</Text> : null}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Return to Atlas" onPress={() => onNavigate('atlas')} style={styles.footer}>
            <AtlasMark small /><View style={{ flex: 1 }}><Text style={styles.footerTitle}>Atlas</Text><Text style={styles.footerText}>A place for your next move</Text></View><LineIcon name="arrow" />
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 }, backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20, 26, 37, 0.28)' },
  drawer: { height: '100%', backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border },
  brandRow: { paddingLeft: 24, paddingRight: 12, minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.border },
  close: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, scroll: { padding: 16 },
  newChat: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 52, borderRadius: 14, backgroundColor: c.orange }, newChatLabel: { fontSize: 15, fontWeight: '700', color: c.surface },
  links: { marginTop: 14, gap: 3 }, link: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 12, minHeight: 52, gap: 14, borderRadius: 12 },
  active: { backgroundColor: c.orangeSoft }, linkCopy: { flex: 1 }, linkLabel: { fontSize: 15, color: c.ink, fontWeight: '500' }, soon: { fontSize: 11, marginTop: 4, color: c.muted },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B53B30' },
  eyebrow: { marginTop: 30, marginBottom: 10, marginLeft: 13, fontSize: 10, letterSpacing: 1.5, color: c.muted, fontWeight: '700' },
  recent: { paddingHorizontal: 13, paddingVertical: 12, minHeight: 56 }, recentTitle: { fontSize: 14, color: c.ink }, recentDate: { fontSize: 11, color: c.muted, marginTop: 6 },
  empty: { color: c.muted, fontSize: 13, padding: 13, lineHeight: 20 },
  footer: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: c.border }, footerTitle: { fontWeight: '700', fontSize: 15, color: c.ink }, footerText: { color: c.muted, fontSize: 11, marginTop: 4 }, pressed: { opacity: 0.65 },
});
