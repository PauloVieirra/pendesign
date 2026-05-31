import { useState } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import type { VariableCollection } from '../../providers/design-system-variables';

interface Props {
  collections: VariableCollection[];
  activeCollectionId: string | null;
  activeGroupId: string | 'all';
  onSelectCollection: (id: string) => void;
  onSelectGroup: (id: string | 'all') => void;
  onCreateCollection: (name: string) => Promise<void> | void;
  onDeleteCollection: (id: string) => Promise<void> | void;
  onCreateGroup: (name: string) => Promise<void> | void;
  onDeleteGroup: (id: string) => Promise<void> | void;
  collapsed?: boolean;
}

export function CollectionsSidebar({
  collections, activeCollectionId, activeGroupId,
  onSelectCollection, onSelectGroup,
  onCreateCollection, onDeleteCollection, onCreateGroup, onDeleteGroup,
  collapsed,
}: Props) {
  const t = useT();
  const [newColl, setNewColl] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const activeCollection = collections.find((c) => c.id === activeCollectionId) ?? null;

  function countVariables(c: VariableCollection): number {
    return c.groups.reduce((acc, g) => acc + g.variables.length, 0);
  }

  if (collapsed) return null;

  return (
    <aside className="ds-sidebar" data-testid="ds-sidebar">
      <SidebarSection
        label={t('ds.modal.collections')}
        onCreate={() => setNewColl('')}
      >
        {collections.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`ds-sidebar__row${c.id === activeCollectionId ? ' is-active' : ''}`}
            onClick={() => onSelectCollection(c.id)}
            data-testid={`ds-sidebar-collection-${c.name}`}
          >
            <span className="ds-sidebar__row-name">{c.name}</span>
            <span className="ds-sidebar__row-count">{countVariables(c)}</span>
          </button>
        ))}
        {newColl !== null ? (
          <input
            autoFocus
            className="ds-sidebar__row-input"
            value={newColl}
            placeholder="Collection name"
            onChange={(ev) => setNewColl(ev.target.value)}
            onBlur={async () => { if (newColl.trim()) await onCreateCollection(newColl.trim()); setNewColl(null); }}
            onKeyDown={async (ev) => {
              if (ev.key === 'Enter') { if (newColl.trim()) await onCreateCollection(newColl.trim()); setNewColl(null); }
              if (ev.key === 'Escape') setNewColl(null);
            }}
          />
        ) : null}
      </SidebarSection>

      <SidebarSection
        label={t('ds.modal.groups')}
        onCreate={activeCollection ? () => setNewGroup('') : undefined}
      >
        <button
          type="button"
          className={`ds-sidebar__row${activeGroupId === 'all' ? ' is-active' : ''}`}
          onClick={() => onSelectGroup('all')}
        >
          <span className="ds-sidebar__row-name">{t('ds.modal.all')}</span>
          <span className="ds-sidebar__row-count">{activeCollection ? countVariables(activeCollection) : 0}</span>
        </button>
        {activeCollection?.groups.map((g) => (
          <button
            type="button"
            key={g.id}
            className={`ds-sidebar__row${g.id === activeGroupId ? ' is-active' : ''}`}
            onClick={() => onSelectGroup(g.id)}
            data-testid={`ds-sidebar-group-${g.name}`}
          >
            <span className="ds-sidebar__row-name">{g.name}</span>
            <span className="ds-sidebar__row-count">{g.variables.length}</span>
          </button>
        ))}
        {newGroup !== null ? (
          <input
            autoFocus
            className="ds-sidebar__row-input"
            value={newGroup}
            placeholder="Group name"
            onChange={(ev) => setNewGroup(ev.target.value)}
            onBlur={async () => { if (newGroup.trim()) await onCreateGroup(newGroup.trim()); setNewGroup(null); }}
            onKeyDown={async (ev) => {
              if (ev.key === 'Enter') { if (newGroup.trim()) await onCreateGroup(newGroup.trim()); setNewGroup(null); }
              if (ev.key === 'Escape') setNewGroup(null);
            }}
          />
        ) : null}
      </SidebarSection>
    </aside>
  );
}

function SidebarSection({ label, onCreate, children }: { label: string; onCreate?: () => void; children: React.ReactNode }) {
  return (
    <div className="ds-sidebar__section">
      <header className="ds-sidebar__section-head">
        <span>{label}</span>
        {onCreate ? (
          <button type="button" className="ds-modal__icon-btn ds-sidebar__add" onClick={onCreate} aria-label={`Add ${label}`}>
            <Icon name="plus" size={11} />
          </button>
        ) : null}
      </header>
      <div className="ds-sidebar__items">{children}</div>
    </div>
  );
}
