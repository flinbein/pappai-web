import type {CSSProperties} from 'react';
// Presets use the Windows Terminal palettes from
// https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/windowsterminal
// Pappai keeps the default xterm.js ANSI colors.
import palettes from './palettes.json';

export type ThemeName = keyof typeof palettes;
export const themes = palettes;
const names = Object.keys(themes) as ThemeName[];
const lightThemes = new Set<ThemeName>(['Gruvbox Light', 'Catppuccin Latte', 'Rosé Pine Dawn', 'One Half Light', 'Tomorrow']);
const storageKey = 'terminal.theme';

export function savedTheme(): ThemeName {
  try {
    const value = localStorage.getItem(storageKey);
    if (value && Object.hasOwn(themes, value)) return value as ThemeName;
  } catch { /* Use the default when storage is unavailable. */ }
  return 'Pappai';
}

export function rememberTheme(theme: ThemeName) {
  try { localStorage.setItem(storageKey, theme); } catch { /* The in-memory choice still applies. */ }
}

export function themeStyle(name: ThemeName): CSSProperties {
  const palette = themes[name];
  return {
    '--term-bg': palette.background,
    '--term-fg': palette.foreground,
    '--term-accent': 'brightBlue' in palette ? palette.brightBlue : '#a6d8c4',
    '--term-selection': palette.selectionBackground,
    '--term-selected-text': palette.selectionForeground,
    colorScheme: lightThemes.has(name) ? 'light' : 'dark',
  } as CSSProperties;
}

export function ThemeChoices({value, choose}: {value: ThemeName; choose(theme: ThemeName): void}) {
  return <div role="group" aria-label="Terminal theme" className="terminal-theme-choices">
    {names.map(name => <button key={name} type="button" aria-pressed={value === name}
      style={themeStyle(name)} onClick={() => choose(name)}>
      <span aria-hidden="true">{value === name ? '✓' : ''}</span>{name}
    </button>)}
  </div>;
}
