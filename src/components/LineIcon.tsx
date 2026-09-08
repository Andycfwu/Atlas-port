import { View, type ViewStyle } from 'react-native';

export type IconName = 'menu' | 'close' | 'plus' | 'search' | 'chat' | 'folder' | 'mic' | 'profile' | 'arrow' | 'pin' | 'plan' | 'trend';

/** Small native line icons; no font or extra native dependency is needed. */
export function LineIcon({ name, color = '#687080' }: { name: IconName; color?: string }) {
  const line = (left: number, top: number, width: number, angle = 0): ViewStyle => ({
    position: 'absolute', left, top, width, height: 1.7, borderRadius: 1, backgroundColor: color,
    transform: [{ rotate: `${angle}deg` }],
  });
  const box = (left: number, top: number, width: number, height: number, radius = 3): ViewStyle => ({
    position: 'absolute', left, top, width, height, borderRadius: radius, borderColor: color, borderWidth: 1.7,
  });
  const shapes: Record<IconName, ViewStyle[]> = {
    menu: [line(3, 6, 18), line(3, 12, 18), line(3, 18, 13)],
    close: [line(3, 11, 18, 45), line(3, 11, 18, -45)],
    plus: [line(4, 11, 16), line(4, 11, 16, 90)],
    search: [box(3, 3, 13, 13, 8), line(14, 17, 8, 45)],
    chat: [box(2, 3, 20, 15, 5), line(3, 19, 5, -45), line(6, 8, 11), line(6, 12, 8)],
    folder: [box(2, 7, 20, 14), box(3, 3, 9, 5, 2)],
    mic: [box(8, 2, 8, 13, 5), { ...box(4, 9, 16, 10, 8), borderTopWidth: 0 }, line(9, 21, 6), line(10, 19, 4, 90)],
    profile: [box(8, 2, 8, 8, 5), box(3, 14, 18, 8, 7)],
    arrow: [line(4, 11, 16), line(13, 8, 8, 45), line(13, 14, 8, -45)],
    pin: [{ ...box(5, 2, 14, 17, 9), transform: [{ rotate: '-45deg' }], borderBottomLeftRadius: 2 }, box(9, 6, 6, 6, 4)],
    plan: [{ ...box(5, 3, 14, 19, 2), transform: [{ rotate: '20deg' }] }, line(9, 9, 7, 20), line(8, 14, 7, 20)],
    trend: [line(2, 15, 9, -40), line(8, 13, 7, 35), line(12, 10, 10, -45), line(16, 6, 6), line(18, 8, 6, 90)],
  };
  return <View accessible={false} style={{ width: 24, height: 24 }}>{shapes[name].map((style, index) => <View key={index} style={style} />)}</View>;
}
