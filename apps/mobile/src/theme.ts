/**
 * Tokens shared with the operator console, so both surfaces read as one product.
 *
 * Sizes are tuned for a herder holding the phone one-handed in a pen: 48dp minimum targets, a
 * large numeric keypad, and contrast that survives direct sunlight (scope NFR-04, NFR-05).
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform, StyleSheet, useColorScheme } from 'react-native';
import { applyBrowserAppearance } from './browserAppearance';

export const lightColors = {
  paper: '#F3F4F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EAECF1',
  ink: '#16233B',
  inkSoft: '#3A4761',
  muted: '#68738C',
  line: '#D8DCE5',
  accent: '#A96613',
  accentSoft: '#F0E3D0',
  sage: '#4A7358',
  sageSoft: '#DFE9E1',
  rust: '#9E3B2C',
  rustSoft: '#F2DFDB',
  onAccent: '#FFFFFF',
} as const;

export type Palette = { [K in keyof typeof lightColors]: string };
export const darkColors: Palette = {
  paper: '#0F1624',
  surface: '#17202F',
  surfaceAlt: '#1E2839',
  ink: '#E4E8F0',
  inkSoft: '#BAC3D3',
  muted: '#A0ACC0',
  line: '#3C4960',
  accent: '#E0A24A',
  accentSoft: '#33291B',
  sage: '#84B694',
  sageSoft: '#1E2E25',
  rust: '#E19486',
  rustSoft: '#33211E',
  onAccent: '#16233B',
};
export type ThemePreference = 'system' | 'light' | 'dark';
const preferenceKey = 'nasl.theme';
const ThemeContext = createContext({
  colors: lightColors as Palette,
  dark: false,
  ready: true,
  preference: 'system' as ThemePreference,
  setPreference: (_preference: ThemePreference) => {},
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setValue] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(preferenceKey)
      .then((value) => {
        if (active && (value === 'light' || value === 'dark')) setValue(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const dark = preference === 'dark' || (preference === 'system' && system === 'dark');
  const colors = dark ? darkColors : lightColors;
  useEffect(() => {
    if (!ready) return;
    if (Platform.OS !== 'web')
      Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    applyBrowserAppearance(dark, colors.paper);
  }, [colors, dark, preference, ready]);
  const setPreference = (value: ThemePreference) => {
    setValue(value);
    void AsyncStorage.setItem(preferenceKey, value).catch(() => {});
  };
  return createElement(
    ThemeContext.Provider,
    { value: { colors, dark, ready, preference, setPreference } },
    children,
  );
}

export const useTheme = () => useContext(ThemeContext);

/** Build both palettes once; subscribers change styles without remounting screens or forms. */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
) {
  const light = StyleSheet.create(factory(lightColors));
  const dark = StyleSheet.create(factory(darkColors));
  return function useStyles() {
    return useTheme().dark ? dark : light;
  };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const type = {
  display: 30,
  title: 22,
  heading: 18,
  body: 16,
  label: 14,
  caption: 12,
} as const;

/** Nothing interactive is smaller than this. Gloves and dust are the operating conditions. */
export const MIN_TOUCH = 48;
