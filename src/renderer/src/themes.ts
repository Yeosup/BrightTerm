import type { ITheme } from '@xterm/xterm'

export const TERMINAL_THEMES: Record<string, ITheme> = {
  'BrightTerm Dark': {
    background: '#0d1117', foreground: '#d6dde6', cursor: '#7dd3fc', cursorAccent: '#0d1117', selectionBackground: '#2f4a6b',
    black: '#1b2029', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d6dde6',
    brightBlack: '#5b6573', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff'
  },
  'BrightTerm Light': {
    background: '#ffffff', foreground: '#1f2937', cursor: '#2563eb', cursorAccent: '#ffffff', selectionBackground: '#bfdbfe',
    black: '#1f2937', red: '#dc2626', green: '#15803d', yellow: '#a16207', blue: '#1d4ed8', magenta: '#9333ea', cyan: '#0e7490', white: '#e5e7eb',
    brightBlack: '#6b7280', brightRed: '#ef4444', brightGreen: '#16a34a', brightYellow: '#ca8a04', brightBlue: '#2563eb', brightMagenta: '#a855f7', brightCyan: '#0891b2', brightWhite: '#f9fafb'
  },
  'PuTTY Classic': {
    background: '#000000', foreground: '#bbbbbb', cursor: '#00ff00', selectionBackground: '#555555',
    black: '#000000', red: '#bb0000', green: '#00bb00', yellow: '#bbbb00', blue: '#0000bb', magenta: '#bb00bb', cyan: '#00bbbb', white: '#bbbbbb',
    brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55', brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff'
  },
  'Solarized Dark': {
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#93a1a1', brightYellow: '#839496', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  Monokai: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5'
  },
  Nord: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
  }
}
