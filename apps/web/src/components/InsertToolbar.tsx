import { Icon, type IconName } from './Icon';

export type InsertToolId = 'text' | 'shape';

interface ToolEntry {
  id: InsertToolId;
  icon: IconName;
  label: string;
}

const TOOLS: ToolEntry[] = [
  { id: 'text', icon: 'edit', label: 'Text' },
  { id: 'shape', icon: 'grid', label: 'Shape' },
];

export function buildInsertedElement(tool: InsertToolId): { id: string; html: string } {
  const id = `od-ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  if (tool === 'text') {
    return {
      id,
      html: `<p data-od-id="${id}" style="font-size: 16px; color: #111;">Text</p>`,
    };
  }
  return {
    id,
    html: `<div data-od-id="${id}" style="width: 120px; height: 120px; background-color: #e5e7eb;"></div>`,
  };
}

interface InsertToolbarProps {
  active: InsertToolId | null;
  onSelectTool: (tool: InsertToolId | null) => void;
  disabled?: boolean;
}

export function InsertToolbar({ active, onSelectTool, disabled }: InsertToolbarProps) {
  return (
    <div className="insert-toolbar" aria-hidden={disabled ? true : undefined}>
      <div className="insert-toolbar-bar" role="toolbar" aria-label="Insert element">
        {TOOLS.map((tool) => {
          const isActive = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`insert-toolbar-tool${isActive ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => onSelectTool(isActive ? null : tool.id)}
              title={tool.label}
              aria-label={tool.label}
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
