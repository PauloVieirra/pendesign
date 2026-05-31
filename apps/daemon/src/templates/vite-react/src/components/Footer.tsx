import './Footer.css';

interface Props {
  hint?: string;
}

export function Footer({ hint }: Props) {
  return (
    <footer className="app-footer">
      <span className="app-footer__pulse" aria-hidden="true" />
      <span>{hint ?? 'Vite dev server is running. Edit any file under src/ to see live updates.'}</span>
    </footer>
  );
}
