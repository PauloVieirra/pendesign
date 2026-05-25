import './Header.css';

interface Props {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: Props) {
  return (
    <header className="app-header">
      <span className="app-header__logo" aria-hidden="true">⚛︎</span>
      <div className="app-header__text">
        <h1 className="app-header__title">{title}</h1>
        {subtitle ? <p className="app-header__subtitle">{subtitle}</p> : null}
      </div>
    </header>
  );
}
