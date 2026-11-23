import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme.tsx';

interface ThemeSwitcherProps {
  variant?: 'segmented' | 'icon' | 'sidebar';
  collapsed?: boolean;
}

export function ThemeSwitcher({
  variant = 'segmented',
  collapsed = false,
}: ThemeSwitcherProps) {
  const { themeId, setThemeId, toggleTheme, isDark } = useTheme();

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        title={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
        aria-label={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors shrink-0"
      >
        {isDark ? (
          <Sun className="h-4 w-4 text-amber-400" />
        ) : (
          <Moon className="h-4 w-4 text-indigo-500" />
        )}
      </button>
    );
  }

  if (variant === 'sidebar') {
    if (collapsed) {
      return (
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
          aria-label={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
          className="w-full flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-sky-300" />
          )}
        </button>
      );
    }

    return (
      <div
        role="group"
        aria-label="Appearance mode"
        className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.05] border border-white/[0.08] p-1"
      >
        {(
          [
            { id: 'light', label: 'Light', icon: Sun },
            { id: 'dark', label: 'Dark', icon: Moon },
          ] as const
        ).map((item) => {
          const active = themeId === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setThemeId(item.id)}
              aria-pressed={active}
              className={`relative flex items-center justify-center gap-1.5 rounded-md py-1.5 px-2 text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-theme-indicator"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-md bg-white/[0.12] border border-white/[0.12]"
                />
              )}
              <Icon
                className={`relative z-10 h-3.5 w-3.5 shrink-0 ${
                  item.id === 'light' ? 'text-amber-400' : 'text-indigo-300'
                }`}
              />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] p-1 shadow-xs"
    >
      {(
        [
          { id: 'light', label: 'Light', icon: Sun },
          { id: 'dark', label: 'Dark', icon: Moon },
        ] as const
      ).map((item) => {
        const active = themeId === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setThemeId(item.id)}
            aria-pressed={active}
            className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              active
                ? 'text-[var(--av-text)]'
                : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
            }`}
          >
            {active && (
              <motion.span
                layoutId="segmented-theme-indicator"
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 rounded-md bg-[var(--av-surface-muted)] border border-[var(--av-border)]"
              />
            )}
            <Icon
              className={`relative z-10 h-3.5 w-3.5 shrink-0 ${
                item.id === 'light'
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-indigo-500 dark:text-indigo-400'
              }`}
            />
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
