import { useState } from 'react';
import type { VariableCollection } from '../../providers/design-system-variables';
import { Icon } from '../Icon';

interface Props {
  collections: VariableCollection[];
  activeCollectionId: string | null;
  onSelect: (collectionId: string) => void;
  onCreate: (name: string) => void;
  onDelete: (collectionId: string) => void;
}

export function CollectionsSidebar({
  collections,
  activeCollectionId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    setCreating(false);
    if (draft.trim()) onCreate(draft.trim());
    setDraft('');
  }

  return (
    <aside className="ds-mgr-sidebar" aria-label="Collections">
      <header className="ds-mgr-sidebar__head">
        <h3>Collections</h3>
        <button
          type="button"
          className="ghost"
          aria-label="New collection"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={13} />
        </button>
      </header>
      <ul>
        {collections.map((collection) => {
          const total = collection.groups.reduce((acc, g) => acc + g.variables.length, 0);
          return (
            <li key={collection.id} className={collection.id === activeCollectionId ? 'active' : ''}>
              <button type="button" onClick={() => onSelect(collection.id)}>
                <span>{collection.name}</span>
                <span className="ds-mgr-sidebar__count">{total}</span>
              </button>
              <button
                type="button"
                className="ghost ds-mgr-sidebar__delete"
                aria-label={`Delete ${collection.name}`}
                onClick={() => onDelete(collection.id)}
              >
                <Icon name="trash" size={11} />
              </button>
            </li>
          );
        })}
        {creating ? (
          <li className="ds-mgr-sidebar__create">
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onBlur={commit}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') commit();
                if (ev.key === 'Escape') { setCreating(false); setDraft(''); }
              }}
              placeholder="Collection name"
            />
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
