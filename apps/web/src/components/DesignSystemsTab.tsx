import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import {
  localizeDesignSystemCategory,
  localizeDesignSystemSummary,
} from '../i18n/content';
import {
  deleteDesignSystemDraft,
  fetchDesignSystemShowcase,
  importFigmaDesignSystem,
  updateDesignSystemDraft,
  verifyFigmaToken,
} from '../providers/registry';
import { buildSrcdoc } from '../runtime/srcdoc';
import { Icon } from './Icon';
import type { DesignSystemSummary, Surface } from '../types';

interface Props {
  systems: DesignSystemSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onCreate?: () => void;
  onOpenSystem?: (id: string) => void;
  onSystemsRefresh?: () => Promise<void> | void;
  /** Optional id of the project that opened this view (via the Design
   * Systems toolbar button on the FileViewer). Drives project-scoped
   * affordances like the inline Figma import that targets the project's
   * connected `figma-context` PAT. */
  projectContext?: string;
}

const CATEGORY_ORDER = [
  'Starter',
  'AI & LLM',
  'Developer Tools',
  'Productivity & SaaS',
  'Backend & Data',
  'Design & Creative',
  'Fintech & Crypto',
  'E-Commerce & Retail',
  'Media & Consumer',
  'Automotive',
];

type SurfaceFilter = 'all' | Surface;
type UserListFilter = 'all' | 'published' | 'draft';

const SURFACE_PILLS: { value: SurfaceFilter; labelKey: 'examples.modeAll' | 'ds.surfaceWeb' | 'ds.surfaceImage' | 'ds.surfaceVideo' | 'ds.surfaceAudio' }[] = [
  { value: 'all', labelKey: 'examples.modeAll' },
  { value: 'web', labelKey: 'ds.surfaceWeb' },
  { value: 'image', labelKey: 'ds.surfaceImage' },
  { value: 'video', labelKey: 'ds.surfaceVideo' },
  { value: 'audio', labelKey: 'ds.surfaceAudio' },
];

function surfaceOf(system: DesignSystemSummary): Surface {
  return system.surface ?? 'web';
}

function isUserSystem(system: DesignSystemSummary): boolean {
  return system.source === 'user' || system.isEditable === true;
}

function formatShortDate(value: string | undefined): string {
  if (!value) return 'just now';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

export function DesignSystemsTab({
  systems,
  selectedId,
  onSelect,
  onPreview,
  onCreate,
  onOpenSystem,
  onSystemsRefresh,
  projectContext,
}: Props) {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState('');
  const [userFilter, setUserFilter] = useState<UserListFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');
  const [category, setCategory] = useState<string>('All');
  // Cache fetched showcase HTML across re-renders so cards never re-flicker
  // when the user filters / scrolls back. null = "in flight"; undefined =
  // "not yet requested". Mirrors the pattern used by ExamplesTab.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  const librarySystems = useMemo(
    () => systems.filter((system) => !isUserSystem(system)),
    [systems],
  );

  const surfaceScoped = useMemo(
    () => surfaceFilter === 'all'
      ? librarySystems
      : librarySystems.filter((s) => surfaceOf(s) === surfaceFilter),
    [librarySystems, surfaceFilter],
  );

  const userSystems = useMemo(() => {
    const editable = systems.filter(isUserSystem);
    if (userFilter === 'all') return editable;
    return editable.filter((system) => (system.status ?? 'draft') === userFilter);
  }, [systems, userFilter]);

  const surfaceCounts = useMemo(() => {
    const counts: Record<SurfaceFilter, number> = { all: librarySystems.length, web: 0, image: 0, video: 0, audio: 0 };
    for (const s of librarySystems) counts[surfaceOf(s)]++;
    return counts;
  }, [librarySystems]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of surfaceScoped) cats.add(s.category || 'Uncategorized');
    const ordered: string[] = [];
    for (const c of CATEGORY_ORDER) if (cats.has(c)) ordered.push(c);
    for (const c of [...cats].sort()) if (!ordered.includes(c)) ordered.push(c);
    return ['All', ...ordered];
  }, [surfaceScoped]);

  // Keep surfaceFilter and category in sync when systems changes dynamically.
  // If the currently selected surface has zero items, fall back to 'all'.
  // If the current category is no longer present in the filtered list, fall back to 'All'.
  useEffect(() => {
    if (surfaceFilter !== 'all' && surfaceCounts[surfaceFilter] === 0) {
      setSurfaceFilter('all');
      setCategory('All');
    } else if (category !== 'All' && !categories.includes(category)) {
      setCategory('All');
    }
  }, [systems, surfaceFilter, surfaceCounts, category, categories]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return surfaceScoped.filter((s) => {
      if (category !== 'All' && (s.category || 'Uncategorized') !== category) return false;
      if (!q) return true;
      const summary = localizeDesignSystemSummary(locale, s).toLowerCase();
      const categoryLabel = localizeDesignSystemCategory(
        locale,
        s.category || 'Uncategorized',
      ).toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        summary.includes(q) ||
        categoryLabel.includes(q)
      );
    });
  }, [surfaceScoped, filter, category, locale]);

  // Category metadata is authored in English; keep raw values in state for
  // filtering while localizing the visible labels for the current UI locale.
  const renderCategory = (c: string) => {
    if (c === 'All') return t('ds.categoryAll');
    if (c === 'Uncategorized') return t('ds.categoryUncategorized');
    return localizeDesignSystemCategory(locale, c);
  };

  function loadThumb(id: string) {
    setThumbs((prev) => {
      if (prev[id] !== undefined) return prev;
      void fetchDesignSystemShowcase(id).then((html) => {
        setThumbs((p) => ({ ...p, [id]: html }));
      });
      return { ...prev, [id]: null };
    });
  }

  async function refreshSystems() {
    await onSystemsRefresh?.();
  }

  async function togglePublished(system: DesignSystemSummary) {
    setBusyId(system.id);
    try {
      await updateDesignSystemDraft(system.id, {
        status: system.status === 'published' ? 'draft' : 'published',
      });
      await refreshSystems();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSystem(system: DesignSystemSummary) {
    const ok = window.confirm(`Delete "${system.title}"? This removes the draft design system from this device.`);
    if (!ok) return;
    setBusyId(system.id);
    try {
      const deleted = await deleteDesignSystemDraft(system.id);
      if (!deleted) return;
      if (selectedId === system.id) {
        const fallback = systems.find((candidate) =>
          candidate.id !== system.id && isUserSystem(candidate),
        );
        if (fallback) onSelect(fallback.id);
      }
      await refreshSystems();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="tab-panel design-systems-manager" data-testid="design-systems-tab">
      <section className="ds-settings-card" aria-label="Design Systems">
        <div className="ds-settings-card__head">
          <div>
            <span className="ds-manager-eyebrow">Design Systems</span>
            <h2>Your systems</h2>
          </div>
          <select
            aria-label="Filter design systems"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value as UserListFilter)}
          >
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        {onCreate ? (
          <button type="button" className="ds-create-row" onClick={onCreate}>
            <span>
              <strong>Create new design system</strong>
              <small>Teach Open Design your brand, product, code, assets, and design references.</small>
            </span>
            <span className="ds-create-row__action">Create</span>
          </button>
        ) : null}
        <FigmaImportRow
          onImported={async () => {
            if (onSystemsRefresh) await onSystemsRefresh();
          }}
          projectContext={projectContext}
        />

        {userSystems.length === 0 ? (
          <div className="ds-user-empty">
            No design systems yet. Create one from real product context, review the draft, then publish it for future projects.
          </div>
        ) : (
          <div className="ds-user-list">
            {userSystems.map((system) => {
              const status = system.status ?? 'draft';
              const canUseInProjects = status === 'published';
              const selected = canUseInProjects && system.id === selectedId;
              const busy = busyId === system.id;
              return (
                <div className="ds-user-row" key={system.id}>
                  <button
                    type="button"
                    className="ds-user-row__open"
                    onClick={() => onOpenSystem?.(system.id)}
                  >
                    <span className="ds-user-row__title">
                      <span>{system.title}</span>
                      {selected ? <span className="ds-card-badge">Default</span> : null}
                    </span>
                    <span className="ds-user-row__meta">
                      You · updated {formatShortDate(system.updatedAt)}
                    </span>
                  </button>
                  <div className="ds-user-row__actions">
                    {onOpenSystem ? (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => onOpenSystem(system.id)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                    ) : null}
                    {!selected && canUseInProjects ? (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => onSelect(system.id)}
                        disabled={busy}
                      >
                        Make default
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`ds-status-toggle ${status === 'published' ? 'is-on' : ''}`}
                      aria-pressed={status === 'published'}
                      onClick={() => void togglePublished(system)}
                      disabled={busy}
                    >
                      <span>{status === 'published' ? 'Published' : 'Draft'}</span>
                      <i aria-hidden />
                    </button>
                    {onOpenSystem ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Open ${system.title}`}
                        onClick={() => onOpenSystem(system.id)}
                      >
                        <Icon name="external-link" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`Delete ${system.title}`}
                      onClick={() => void deleteSystem(system)}
                      disabled={busy}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ds-settings-card ds-templates-card" aria-label="Templates">
        <div className="ds-settings-card__head">
          <div>
            <span className="ds-manager-eyebrow">Templates</span>
            <h2>Templates</h2>
          </div>
        </div>
        <div className="ds-user-empty">
          No templates yet. Create one from any generated project via Share once template publishing is enabled.
        </div>
      </section>

      <p className="ds-private-note">Only you can view these settings.</p>

      <section className="ds-settings-card" aria-label="Built-in design systems">
        <div className="ds-settings-card__head">
          <div>
            <span className="ds-manager-eyebrow">Library</span>
            <h2>Built-in library</h2>
          </div>
        </div>
        <div className="tab-panel-toolbar ds-manager-toolbar">
          <input
            data-testid="design-systems-search"
            placeholder={t('ds.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            data-testid="design-systems-category-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {renderCategory(c)}
              </option>
            ))}
          </select>
        </div>
        <div
          className="examples-filter-row"
          role="tablist"
          aria-label={t('ds.surfaceLabel')}
        >
          <span className="examples-filter-label">{t('ds.surfaceLabel')}</span>
          {SURFACE_PILLS.filter((p) => p.value === 'all' || surfaceCounts[p.value] > 0).map((p) => (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={surfaceFilter === p.value}
              data-testid={`design-systems-surface-${p.value}`}
              className={`filter-pill ${surfaceFilter === p.value ? 'active' : ''}`}
              onClick={() => {
                setSurfaceFilter(p.value);
                setCategory('All');
              }}
            >
              {t(p.labelKey)}
              <span className="filter-pill-count">{surfaceCounts[p.value]}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="tab-empty" data-testid="design-systems-empty">{t('ds.emptyNoMatch')}</div>
        ) : (
          <div className="ds-grid" data-testid="design-systems-grid">
            {filtered.map((s) => (
              <DesignSystemCard
                key={s.id}
                system={s}
                active={s.id === selectedId}
                thumbHtml={thumbs[s.id]}
                onIntersect={() => loadThumb(s.id)}
                onSelect={() => onSelect(s.id)}
                onOpenSystem={onOpenSystem ? () => onOpenSystem(s.id) : undefined}
                onPreview={() => onPreview(s.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface CardProps {
  system: DesignSystemSummary;
  active: boolean;
  thumbHtml: string | null | undefined;
  onIntersect: () => void;
  onSelect: () => void;
  onOpenSystem?: () => void;
  onPreview: () => void;
}

function DesignSystemCard({
  system,
  active,
  thumbHtml,
  onIntersect,
  onSelect,
  onOpenSystem,
  onPreview,
}: CardProps) {
  const { locale, t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);

  // Lazy-load the showcase iframe only when the card scrolls into the
  // viewport. With ~120 design systems we can't afford to mount every
  // iframe up front — even with `loading="lazy"`, srcDoc iframes ignore
  // the native lazy hint, so we gate via IntersectionObserver.
  useEffect(() => {
    if (thumbHtml !== undefined) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      onIntersect();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onIntersect();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbHtml, onIntersect]);

  const localizedSummary = localizeDesignSystemSummary(locale, system);
  const categoryLabel = localizeDesignSystemCategory(
    locale,
    system.category || 'Uncategorized',
  );

  return (
    <div
      ref={ref}
      className={`ds-card ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      data-testid={`design-system-card-${system.id}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div
      className="ds-card-thumb"
      data-testid={`design-system-preview-${system.id}`}
      onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        title={t('ds.previewTitle')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onPreview();
          }
        }}
      >
        {thumbHtml ? (
          <iframe
            title={`${system.title} preview`}
            sandbox="allow-scripts"
            srcDoc={buildSrcdoc(thumbHtml)}
            tabIndex={-1}
            aria-hidden
          />
        ) : (
          <div className="ds-card-thumb-fallback" aria-hidden>
            {system.swatches && system.swatches.length > 0 ? (
              <div className="ds-card-thumb-swatches">
                {system.swatches.map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </div>
            ) : (
              <span className="ds-card-thumb-placeholder">
                {thumbHtml === null ? '' : ''}
              </span>
            )}
          </div>
        )}
        <span className="ds-card-thumb-overlay" aria-hidden>
          {t('ds.preview')}
        </span>
      </div>
      <div className="ds-card-meta" data-testid={`design-system-select-${system.id}`}>
        <div className="ds-card-title-row">
          <span className="ds-card-title">{system.title}</span>
          {active ? (
            <span className="ds-card-badge">{t('ds.badgeDefault')}</span>
          ) : null}
        </div>
        <div className="ds-card-summary">{localizedSummary}</div>
        <div className="ds-card-footer">
          <span className="ds-card-category">{categoryLabel}</span>
          {system.swatches && system.swatches.length > 0 ? (
            <div className="ds-card-swatches" aria-hidden>
              {system.swatches.map((c, i) => (
                <span key={i} style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}
        </div>
        {onOpenSystem ? (
          <button
            type="button"
            className="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSystem();
            }}
          >
            <Icon name={system.isEditable ? 'edit' : 'external-link'} />
            {system.isEditable ? 'Edit' : 'Open'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface FigmaImportRowProps {
  onImported: () => Promise<void> | void;
  projectContext: string | undefined;
}

type WizardPhase =
  | 'verifying' // initial token check against the saved value
  | 'need-token' // saved token failed or never existed — ask the user
  | 'ready' // token verified; collect the URL
  | 'importing' // import request in flight
  | 'done'; // import succeeded

interface FigmaUser {
  handle: string | null;
  email: string | null;
}

/**
 * Two-phase wizard for "Design system from Figma":
 *
 *   1. Verify a token (saved or pasted) by hitting /v1/me. Persists a
 *      freshly-pasted token to the figma-context MCP env on success so
 *      the New Project Figma step reuses it.
 *   2. Once verified, collect the Figma URL and run the tokens import.
 *
 * Skipping straight to URL collection when no usable token exists hits
 * the same 401/403 we already had — verifying first keeps the failure
 * scoped to the token step so the user knows exactly what to fix.
 *
 * No components are extracted — tokens only (colors, typography,
 * effects, sampled spacing/radii).
 */
function FigmaImportRow({ onImported, projectContext }: FigmaImportRowProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<WizardPhase>('verifying');
  const [pat, setPat] = useState('');
  const [verifiedUser, setVerifiedUser] = useState<FigmaUser | null>(null);
  const [figmaUrl, setFigmaUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [importedSummary, setImportedSummary] = useState<string | null>(null);

  function reset() {
    setPhase('verifying');
    setPat('');
    setVerifiedUser(null);
    setFigmaUrl('');
    setError(null);
    setStatusMsg(null);
    setImportedSummary(null);
  }

  // On open: kick off an automatic verification of whatever the
  // figma-context MCP server currently has. No user input required at
  // this stage; if it succeeds we jump straight to URL collection,
  // otherwise we prompt for a fresh PAT.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setPhase('verifying');
      setError(null);
      setStatusMsg(null);
      const result = await verifyFigmaToken();
      if (cancelled) return;
      if ('error' in result) {
        setPhase('need-token');
        setError(result.error.code === 'FIGMA_TOKEN_REQUIRED'
          ? 'No Figma token configured yet. Paste a personal access token below to connect.'
          : result.error.message);
        return;
      }
      setVerifiedUser(result.user);
      setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, [open]);

  async function handleVerifyPat(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Strip any whitespace / pasted surrounding characters — the Figma
    // PAT format is `figd_` + URL-safe characters. We do this here so
    // that a paste of "Token: figd_xyz ..." still verifies cleanly.
    const cleaned = pat.replace(/\s+/g, '').trim();
    if (!cleaned || phase === 'verifying') return;
    setPhase('verifying');
    setError(null);
    setStatusMsg('Verifying with Figma…');
    const result = await verifyFigmaToken(cleaned);
    if ('error' in result) {
      setPhase('need-token');
      setStatusMsg(null);
      setError(result.error.message);
      return;
    }
    setVerifiedUser(result.user);
    setPat('');
    setStatusMsg(null);
    setError(null);
    setPhase('ready');
  }

  async function handleImport(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const url = figmaUrl.trim();
    if (!url || phase === 'importing') return;
    setPhase('importing');
    setError(null);
    setStatusMsg('Reading Figma styles…');
    const result = await importFigmaDesignSystem({ figmaUrl: url });
    if ('error' in result) {
      const code = result.error.code;
      if (
        code === 'FIGMA_TOKEN_REQUIRED'
        || code === 'FIGMA_TOKEN_INVALID'
        || code === 'FIGMA_FORBIDDEN'
      ) {
        // Saved token became invalid between verify and import (or it
        // lacked the file-scope while passing /v1/me). Drop back to the
        // token step.
        setPhase('need-token');
        setVerifiedUser(null);
        setStatusMsg(null);
        setError(result.error.message);
        return;
      }
      setPhase('ready');
      setStatusMsg(null);
      setError(result.error.message);
      return;
    }
    const stats = result.stats?.inline;
    const summaryBits: string[] = [];
    if (result.stats && result.stats.variables.count > 0) summaryBits.push(`${result.stats.variables.count} variables`);
    if (result.stats && result.stats.publishedStyles.count > 0) summaryBits.push(`${result.stats.publishedStyles.count} published styles`);
    if (stats) {
      const inlineCount = stats.colors + stats.fonts + stats.shadows + stats.spacings + stats.radii;
      if (inlineCount > 0) summaryBits.push(`${inlineCount} inline tokens`);
    }
    const summarySrc = summaryBits.length > 0 ? `(${summaryBits.join(' · ')})` : '';
    setImportedSummary(
      `Imported "${result.designSystem.title}" ${summarySrc}\n${(result.warnings ?? []).map((w) => `⚠ ${w}`).join('\n')}`.trim(),
    );
    setStatusMsg(null);
    setPhase('done');
    setFigmaUrl('');
    await onImported();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ds-create-row"
        onClick={() => { reset(); setOpen(true); }}
        data-testid="ds-import-figma-open"
      >
        <span>
          <strong>Import from Figma</strong>
          <small>
            Paste any Figma URL (file, page, or frame) and we&apos;ll extract its color, typography, and effect tokens into a new design system. Components are not extracted.
          </small>
        </span>
        <span className="ds-create-row__action">Import</span>
      </button>
    );
  }

  return (
    <div className="ds-figma-import" data-testid="ds-import-figma-form">
      <header className="ds-figma-import__head">
        <div>
          <strong>Import from Figma</strong>
          <small>Tokens only — colors, typography, effects, plus sampled spacing/radii from the targeted node.</small>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => { setOpen(false); reset(); }}
        >
          Cancel
        </button>
      </header>

      {phase === 'verifying' && !pat ? (
        <p className="ds-figma-import__status" data-testid="ds-import-figma-checking">
          Checking the Figma token saved in <strong>Settings → Integrations → MCP → figma-context</strong>…
        </p>
      ) : null}

      {phase === 'need-token' || (phase === 'verifying' && pat) ? (
        <form className="ds-figma-import__step" onSubmit={handleVerifyPat}>
          <label className="ds-figma-import__field">
            <span>Step 1 · Personal access token</span>
            <input
              type="password"
              value={pat}
              placeholder="figd_..."
              onChange={(ev) => setPat(ev.target.value)}
              autoComplete="off"
              data-testid="ds-import-figma-pat"
              required
              disabled={phase === 'verifying'}
            />
            <small>
              Generate at <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noreferrer noopener">Figma → Settings → Personal access tokens</a> with <strong>Read all files</strong> and <strong>Read your user info</strong> checked. We will verify before continuing, and the token is saved to the figma-context MCP server so the New Project Figma step reuses it.
            </small>
          </label>
          {error ? <p className="ds-figma-import__error" role="alert">{error}</p> : null}
          {statusMsg ? <p className="ds-figma-import__status">{statusMsg}</p> : null}
          <div className="ds-figma-import__actions">
            <button
              type="submit"
              className="primary"
              disabled={phase === 'verifying' || pat.trim().length === 0}
              data-testid="ds-import-figma-verify"
            >
              {phase === 'verifying' ? 'Verifying…' : 'Verify and continue'}
            </button>
          </div>
        </form>
      ) : null}

      {(phase === 'ready' || phase === 'importing' || phase === 'done') && verifiedUser ? (
        <p className="ds-figma-import__status" data-testid="ds-import-figma-token-ok">
          Connected to Figma as <strong>{verifiedUser.handle || verifiedUser.email || 'authenticated user'}</strong>. Using the token saved in <strong>Settings → Integrations → MCP → figma-context</strong>.
        </p>
      ) : null}

      {phase === 'ready' || phase === 'importing' ? (
        <form className="ds-figma-import__step" onSubmit={handleImport}>
          <label className="ds-figma-import__field">
            <span>Step 2 · Figma URL</span>
            <input
              type="url"
              required
              value={figmaUrl}
              placeholder="https://www.figma.com/design/abc123/My-File?node-id=10-2"
              onChange={(ev) => setFigmaUrl(ev.target.value)}
              data-testid="ds-import-figma-url"
              disabled={phase === 'importing'}
              autoFocus
            />
            <small>
              File, page, or frame URL. If you include a <code>node-id</code> Open Design will also sample spacing and radii from that subtree.
            </small>
          </label>
          {projectContext ? (
            <p className="ds-figma-import__hint">
              After importing, set the new design system as the active one for this project from Project settings.
            </p>
          ) : null}
          {error && phase !== 'done' ? <p className="ds-figma-import__error" role="alert">{error}</p> : null}
          {statusMsg ? <p className="ds-figma-import__status">{statusMsg}</p> : null}
          <div className="ds-figma-import__actions">
            <button
              type="submit"
              className="primary"
              disabled={phase === 'importing' || figmaUrl.trim().length === 0}
              data-testid="ds-import-figma-submit"
            >
              {phase === 'importing' ? 'Importing…' : 'Import tokens'}
            </button>
          </div>
        </form>
      ) : null}

      {phase === 'done' && importedSummary ? (
        <p
          className="ds-figma-import__status"
          data-testid="ds-import-figma-done"
          style={{ whiteSpace: 'pre-line' }}
        >
          {importedSummary}
        </p>
      ) : null}
      {phase === 'done' ? (
        <div className="ds-figma-import__actions">
          <button
            type="button"
            className="primary"
            onClick={() => { reset(); setOpen(false); }}
          >
            Done
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setFigmaUrl('');
              setError(null);
              setStatusMsg(null);
              setImportedSummary(null);
              setPhase('ready');
            }}
          >
            Import another
          </button>
        </div>
      ) : null}
    </div>
  );
}
