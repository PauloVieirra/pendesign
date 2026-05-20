import type { Dict } from '../i18n/types';
import { Icon, type IconName } from './Icon';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type InsertToolId = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'image';

interface ToolEntry {
  id: InsertToolId;
  icon: IconName;
  labelKey:
    | 'fileViewer.insertToolbar.frame'
    | 'fileViewer.insertToolbar.rectangle'
    | 'fileViewer.insertToolbar.ellipse'
    | 'fileViewer.insertToolbar.text'
    | 'fileViewer.insertToolbar.image';
}

const TOOLS: ToolEntry[] = [
  { id: 'frame', icon: 'frame-corners', labelKey: 'fileViewer.insertToolbar.frame' },
  { id: 'rectangle', icon: 'square', labelKey: 'fileViewer.insertToolbar.rectangle' },
  { id: 'ellipse', icon: 'circle', labelKey: 'fileViewer.insertToolbar.ellipse' },
  { id: 'text', icon: 'type', labelKey: 'fileViewer.insertToolbar.text' },
  { id: 'image', icon: 'image', labelKey: 'fileViewer.insertToolbar.image' },
];

/**
 * Builds the HTML for a newly-inserted element. Each template carries a
 * unique `data-od-id` so the manual-edit bridge picks it up immediately and
 * the user can configure it without an extra click.
 */
export function buildInsertedElement(tool: InsertToolId): { id: string; html: string } {
  const id = `od-ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const placeholderSvg =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'><rect width='4' height='3' fill='%23e5e7eb'/></svg>";
  const templates: Record<InsertToolId, string> = {
    frame: `<div data-od-id="${id}" style="width: 100%; min-height: 80px; padding: 16px; background-color: #f5f5f5;"></div>`,
    rectangle: `<div data-od-id="${id}" style="width: 200px; height: 80px; background-color: #4a90e2; border-radius: 8px;"></div>`,
    ellipse: `<div data-od-id="${id}" style="width: 80px; height: 80px; background-color: #50c878; border-radius: 50%;"></div>`,
    text: `<p data-od-id="${id}" style="font-size: 16px; color: #111;">Text</p>`,
    image: `<img data-od-id="${id}" src="${placeholderSvg}" alt="Image" style="width: 200px; height: 120px;" />`,
  };
  return { id, html: templates[tool] };
}

interface InsertToolbarProps {
  active: InsertToolId | null;
  onSelectTool: (tool: InsertToolId | null) => void;
  disabled?: boolean;
  t: TranslateFn;
}

/**
 * Figma-style floating toolbar with shape/frame/text/image insertion tools.
 * Positioned slightly above the bottom of the canvas.
 *
 * Clicking a tool arms it (rather than inserting immediately) — the next
 * click inside the canvas commits the insertion into the clicked frame.
 * Clicking the same tool again, pressing Escape, or completing an insertion
 * disarms the tool.
 */
export function InsertToolbar({ active, onSelectTool, disabled, t }: InsertToolbarProps) {
  return (
    <div className="insert-toolbar" aria-hidden={disabled ? true : undefined}>
      <div
        className="insert-toolbar-bar"
        role="toolbar"
        aria-label={t('fileViewer.insertToolbar.aria')}
      >
        {TOOLS.map((tool) => {
          const isActive = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`insert-toolbar-tool${isActive ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => onSelectTool(isActive ? null : tool.id)}
              title={t(tool.labelKey)}
              aria-label={t(tool.labelKey)}
              aria-pressed={isActive}
            >
              <Icon name={tool.icon} size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
