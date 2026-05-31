import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'primary', children, className, ...rest }: Props) {
  return (
    <button
      className={`app-button app-button--${variant} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
