import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeId = 'light' | 'dark';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  modeLabel: 'Light' | 'Dark';
  isDark: boolean;
  accentHex: string;
  tealHex: string;
  gridStroke: string;
  tickColor: string;
  bannerBg: string;
}

export const THEME_PRESETS: Record<ThemeId, ThemePreset> = {
  light: {
    id: 'light',
    name: 'Light',
    modeLabel: 'Light',
    isDark: false,
    accentHex: '#3B82F6',
    tealHex: '#14B8A6',
    gridStroke: '#E2E8F0',
    tickColor: '#64748B',
    bannerBg: '#111827',
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    modeLabel: 'Dark',
    isDark: true,
    accentHex: '#3B82F6',
    tealHex: '#14B8A6',
    gridStroke: 'rgba(148, 163, 184, 0.14)',
    tickColor: '#94A3B8',
    bannerBg: '#111827',
  },
};

const STORAGE_KEY = 'assetvault_theme';

interface ThemeContextValue {
  themeId: ThemeId;
  theme: ThemePreset;
  isDark: boolean;
  setThemeId: (id: ThemeId) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'obsidian' || stored === 'emerald') {
      return 'dark';
    }
    if (stored === 'light' || stored === 'nordic' || stored === 'titanium') {
      return 'light';
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage errors
  }
  return 'light';
}

function applyThemeToDocument(preset: ThemePreset) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = preset.id;
  if (preset.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(resolveInitialTheme);

  const theme = useMemo(() => THEME_PRESETS[themeId], [themeId]);

  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeIdState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      theme,
      isDark: theme.isDark,
      setThemeId,
      toggleTheme,
    }),
    [themeId, theme, setThemeId, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
