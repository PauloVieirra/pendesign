// Toolbar theme toggle — always visible next to Present so the user can
// flip light ↔ dark without opening Settings. Keeps three sources of truth
// aligned via a single custom event:
//
//   1. `document.documentElement[data-theme]` (CSS variables read this)
//   2. localStorage via `saveConfig()` (persists across reloads)
//   3. App.tsx's React state (so the SettingsDialog picker mirrors the
//      toolbar choice next time the user opens it)
//
// The toggle writes (1) and (2) directly, then dispatches an
// `od:theme-change` window event. App.tsx listens for that event and
// calls `setConfig` to sync (3). This is decoupled — the toggle doesn't
// need any prop drilling and works the same in every viewer that mounts
// it (HtmlViewer, LiveArtifactViewer, future viewers).

import { useCallback, useEffect, useState } from 'react';

import { useT } from '../i18n';
import { loadConfig, saveConfig } from '../state/config';
import { applyAppearanceToDocument } from '../state/appearance';
import type { AppTheme } from '../types';
import { Icon } from './Icon';

export const OD_THEME_CHANGE_EVENT = 'od:theme-change';

export interface OdThemeChangeDetail {
  theme: AppTheme;
}

function resolveActiveTheme(theme: AppTheme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const [theme, setThemeState] = useState<AppTheme>(() => {
    if (typeof window === 'undefined') return 'system';
    return loadConfig().theme ?? 'system';
  });

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<OdThemeChangeDetail>).detail;
      if (!detail) return;
      setThemeState(detail.theme);
    };
    window.addEventListener(OD_THEME_CHANGE_EVENT, handler);
    return () => window.removeEventListener(OD_THEME_CHANGE_EVENT, handler);
  }, []);

  const onClick = useCallback(() => {
    const cfg = loadConfig();
    const current = cfg.theme ?? 'system';
    const resolved = resolveActiveTheme(current);
    const next: AppTheme = resolved === 'dark' ? 'light' : 'dark';
    const nextCfg = { ...cfg, theme: next };
    saveConfig(nextCfg);
    applyAppearanceToDocument({ theme: next, accentColor: nextCfg.accentColor });
    window.dispatchEvent(
      new CustomEvent<OdThemeChangeDetail>(OD_THEME_CHANGE_EVENT, { detail: { theme: next } }),
    );
  }, []);

  const active = resolveActiveTheme(theme);
  const goingTo = active === 'dark' ? 'light' : 'dark';
  const label = t(
    goingTo === 'dark' ? 'fileViewer.themeToggleToDark' : 'fileViewer.themeToggleToLight',
  );

  return (
    <button
      type="button"
      className={`chrome-action chrome-action-secondary theme-toggle${className ? ' ' + className : ''}`}
      data-theme-active={active}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon name={active === 'dark' ? 'sun' : 'moon'} size={13} />
    </button>
  );
}
