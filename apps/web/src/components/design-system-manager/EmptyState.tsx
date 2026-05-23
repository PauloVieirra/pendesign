import { Icon } from '../Icon';

interface Props {
  projectName: string;
  onPickFromLibrary: () => void;
  onImportFromFigma: () => void;
  onCreateNew: () => void;
}

export function DesignSystemEmptyState({
  projectName,
  onPickFromLibrary,
  onImportFromFigma,
  onCreateNew,
}: Props) {
  return (
    <div className="ds-mgr-empty">
      <h2>This project has no design system yet</h2>
      <p>
        Attach a design system to <strong>{projectName}</strong> to define
        colors, typography, spacing, and other tokens that the project's
        screens can bind to. The design system is exclusive to this project.
      </p>
      <div className="ds-mgr-empty__actions">
        <button type="button" className="primary" onClick={onCreateNew} data-testid="ds-mgr-create-new">
          <Icon name="plus" size={14} /> Create new
        </button>
        <button type="button" onClick={onImportFromFigma} data-testid="ds-mgr-import-figma">
          Import from Figma
        </button>
        <button type="button" onClick={onPickFromLibrary} data-testid="ds-mgr-pick-library">
          Pick from library
        </button>
      </div>
    </div>
  );
}
