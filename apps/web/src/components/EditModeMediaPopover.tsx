import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { ManualEditMediaRequestKind, ManualEditMediaTarget, ManualEditRect } from '../edit-mode/types';

const ICON_CATALOG: IconName[] = [
  'arrow-left','arrow-up','attach','bell','check','chevron-down','chevron-left','chevron-right',
  'close','copy','comment','discord','download','draw','edit','external-link','eye','eye-off',
  'file','file-code','folder','github','grid','hammer','help-circle','history','home','image',
  'import','info','kanban','languages','link','mic','minus','more-horizontal','orbit','palette',
  'pencil','plus','star','play','present','refresh','reload','search','send','settings','share',
  'sliders','sparkles','stop','sun','moon','sun-moon','thumbs-up','thumbs-down','tweaks','upload',
  'trash','zoom-in','zoom-out',
];

export interface EditModeMediaPopoverState {
  open: boolean;
  targetId: string;
  mediaKind: ManualEditMediaRequestKind;
  mediaTarget: ManualEditMediaTarget;
  rect: ManualEditRect;
  currentSrc: string;
  currentAlt: string;
  tagName: string;
  outerHtml: string;
}

export function emptyEditModeMediaPopoverState(): EditModeMediaPopoverState {
  return { open: false, targetId: '', mediaKind: 'image', mediaTarget: 'src', rect: { x: 0, y: 0, width: 0, height: 0 }, currentSrc: '', currentAlt: '', tagName: '', outerHtml: '' };
}

/**
 * Renders the SVG for a given icon name as a static markup string. Used to
 * build the `set-outer-html` patch payload when the user swaps an inline icon
 * from the catalog.
 */
export function iconNameToSvgMarkup(name: IconName, size = 24): string {
  return renderToStaticMarkup(<Icon name={name} size={size} />);
}

export function EditModeMediaPopover({
  state,
  onClose,
  onPickImageFile,
  onSubmitImageUrl,
  onSubmitIcon,
  onSubmitOuterHtml,
  iframeRect,
}: {
  state: EditModeMediaPopoverState;
  onClose: () => void;
  onPickImageFile: () => void;
  onSubmitImageUrl: (src: string, alt: string) => void;
  onSubmitIcon: (svgMarkup: string) => void;
  onSubmitOuterHtml: (html: string) => void;
  iframeRect: DOMRect | null;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [tab, setTab] = useState<'catalog' | 'url'>('catalog');
  const [sourceSrcs, setSourceSrcs] = useState<string[]>([]);
  const [sourceSrcsets, setSourceSrcsets] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  const hasSources = state.outerHtml && (state.tagName === 'picture' || state.tagName === 'video' || state.tagName === 'audio');

  useEffect(() => {
    if (!state.open) return;
    setImageUrl(state.currentSrc);
    setImageAlt(state.currentAlt);
    setIconUrl('');
    setTab('catalog');
    if (hasSources) {
      const parsed = parseSources(state.outerHtml);
      setSourceSrcs(parsed.srcs);
      setSourceSrcsets(parsed.srcsets);
    } else {
      setSourceSrcs([]);
      setSourceSrcsets([]);
    }
  }, [state.open, state.targetId, state.currentSrc, state.currentAlt, state.outerHtml, hasSources]);

  useEffect(() => {
    if (!state.open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [state.open, onClose]);

  if (!state.open) return null;

  const anchor = iframeRect ?? new DOMRect();
  const left = Math.round(anchor.left + state.rect.x);
  const top = Math.round(anchor.top + state.rect.y + state.rect.height + 8);
  const positionStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(left, window.innerWidth - 360),
    top: Math.min(top, window.innerHeight - 320),
    zIndex: 1000,
  };

  return (
    <div ref={ref} className="cc-panel od-edit-media-popover" style={positionStyle} role="dialog" aria-label={state.mediaKind === 'image' ? 'Replace image' : 'Replace icon'}>
      {state.mediaKind === 'image' ? (
        <div className="od-edit-media-body">
          <header className="od-edit-media-head">{state.mediaTarget === 'background' ? 'Replace background' : 'Replace image'}</header>
          <button type="button" className="od-edit-media-primary" onClick={onPickImageFile}>
            Upload file
          </button>
          <label className="od-edit-media-label">
            <span>Image URL</span>
            <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.currentTarget.value)} placeholder="https://…" />
          </label>
          <label className="od-edit-media-label">
            <span>Alt text</span>
            <input type="text" value={imageAlt} onChange={(e) => setImageAlt(e.currentTarget.value)} placeholder="Describe the image" />
          </label>
          {hasSources && sourceSrcs.length > 0 ? (
            <div className="od-edit-media-sources">
              <header className="od-edit-media-sub-head">{`<source> children (${sourceSrcs.length})`}</header>
              {sourceSrcs.map((src, idx) => (
                <div key={idx} className="od-edit-media-source-row">
                  <label className="od-edit-media-label">
                    <span>src #{idx + 1}</span>
                    <input
                      type="url"
                      value={src}
                      onChange={(e) => {
                        const next = sourceSrcs.slice();
                        next[idx] = e.currentTarget.value;
                        setSourceSrcs(next);
                      }}
                      placeholder="https://…"
                    />
                  </label>
                  {sourceSrcsets[idx] !== undefined ? (
                    <label className="od-edit-media-label">
                      <span>srcset #{idx + 1}</span>
                      <input
                        type="text"
                        value={sourceSrcsets[idx]}
                        onChange={(e) => {
                          const next = sourceSrcsets.slice();
                          next[idx] = e.currentTarget.value;
                          setSourceSrcsets(next);
                        }}
                        placeholder="url1 1x, url2 2x"
                      />
                    </label>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className="od-edit-media-apply"
                onClick={() => onSubmitOuterHtml(rebuildOuterHtmlWithSources(state.outerHtml, sourceSrcs, sourceSrcsets))}
              >
                Apply sources
              </button>
            </div>
          ) : null}
          <footer className="od-edit-media-foot">
            <button type="button" className="cc-inspector-page" onClick={onClose}>Cancel</button>
            <button type="button" className="od-edit-media-apply" disabled={!imageUrl.trim()} onClick={() => onSubmitImageUrl(imageUrl.trim(), imageAlt.trim())}>
              Apply
            </button>
          </footer>
        </div>
      ) : (
        <div className="od-edit-media-body">
          <header className="od-edit-media-head">Replace icon</header>
          <div className="od-edit-media-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'od-edit-media-tab od-edit-media-tab-active' : 'od-edit-media-tab'} onClick={() => setTab('catalog')}>Catalog</button>
            <button type="button" role="tab" aria-selected={tab === 'url'} className={tab === 'url' ? 'od-edit-media-tab od-edit-media-tab-active' : 'od-edit-media-tab'} onClick={() => setTab('url')}>URL</button>
          </div>
          {tab === 'catalog' ? (
            <div className="od-edit-icon-grid">
              {ICON_CATALOG.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="od-edit-icon-tile"
                  title={name}
                  onClick={() => onSubmitIcon(iconNameToSvgMarkup(name))}
                  aria-label={name}
                >
                  <Icon name={name} size={20} />
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className="od-edit-media-label">
                <span>SVG URL</span>
                <input type="url" value={iconUrl} onChange={(e) => setIconUrl(e.currentTarget.value)} placeholder="https://…/icon.svg" />
              </label>
              <footer className="od-edit-media-foot">
                <button type="button" className="cc-inspector-page" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  className="od-edit-media-apply"
                  disabled={!iconUrl.trim()}
                  onClick={() => {
                    const src = iconUrl.trim();
                    onSubmitIcon(`<img src="${escapeAttribute(src)}" alt="" width="24" height="24" />`);
                  }}
                >
                  Apply
                </button>
              </footer>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseSources(outerHtml: string): { srcs: string[]; srcsets: string[] } {
  if (typeof DOMParser === 'undefined') return { srcs: [], srcsets: [] };
  try {
    const doc = new DOMParser().parseFromString(outerHtml, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return { srcs: [], srcsets: [] };
    const sources = Array.from(root.querySelectorAll('source'));
    return {
      srcs: sources.map((s) => s.getAttribute('src') ?? ''),
      srcsets: sources.map((s) => s.getAttribute('srcset') ?? ''),
    };
  } catch {
    return { srcs: [], srcsets: [] };
  }
}

export function rebuildOuterHtmlWithSources(outerHtml: string, srcs: string[], srcsets: string[]): string {
  if (typeof DOMParser === 'undefined') return outerHtml;
  try {
    const doc = new DOMParser().parseFromString(outerHtml, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return outerHtml;
    const sources = Array.from(root.querySelectorAll('source'));
    sources.forEach((s, index) => {
      if (srcs[index] !== undefined) {
        if (srcs[index] === '') s.removeAttribute('src');
        else s.setAttribute('src', srcs[index]!);
      }
      if (srcsets[index] !== undefined) {
        if (srcsets[index] === '') s.removeAttribute('srcset');
        else s.setAttribute('srcset', srcsets[index]!);
      }
    });
    return root.outerHTML;
  } catch {
    return outerHtml;
  }
}
