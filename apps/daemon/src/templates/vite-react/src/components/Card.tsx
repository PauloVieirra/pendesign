import type { ReactNode } from 'react';
import './Card.css';

interface Props {
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
}

export function Card({ title, icon, children }: Props) {
  return (
    <article className="app-card">
      {(title || icon) ? (
        <header className="app-card__head">
          {icon ? <span className="app-card__icon">{icon}</span> : null}
          {title ? <h3 className="app-card__title">{title}</h3> : null}
        </header>
      ) : null}
      <div className="app-card__body">{children}</div>
    </article>
  );
}
