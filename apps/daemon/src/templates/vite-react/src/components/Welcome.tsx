import { useState } from 'react';
import { Header } from './Header';
import { Card } from './Card';
import { Button } from './Button';
import { Footer } from './Footer';
import './Welcome.css';

export function Welcome() {
  const [count, setCount] = useState(0);
  return (
    <main className="welcome">
      <Header
        title="Your React project is ready"
        subtitle="Vite + React + TypeScript scaffolded by Open Design"
      />

      <section className="welcome__cards">
        <Card title="Components folder" icon="📁">
          Reusable building blocks live under <code>src/components/</code>.
          This screen is built from <code>Header</code>, <code>Card</code>,
          <code>Button</code> and <code>Footer</code> — import and compose.
        </Card>
        <Card title="Live reload" icon="⚡">
          Edit any <code>.tsx</code>, <code>.ts</code>, or <code>.css</code>
          file. Vite&apos;s HMR pushes the change here without a reload.
        </Card>
        <Card title="Add packages" icon="📦">
          The dev server uses the project&apos;s own <code>package.json</code>
          and <code>node_modules</code>. Run <code>npm install &lt;pkg&gt;</code>
          from the project folder to add dependencies.
        </Card>
      </section>

      <section className="welcome__demo">
        <h2 className="welcome__demo-title">Quick demo</h2>
        <p className="welcome__demo-copy">
          The counter below uses <code>useState</code> and the shared
          <code> Button</code> component — both will update instantly when you
          edit them.
        </p>
        <div className="welcome__demo-actions">
          <Button onClick={() => setCount((c) => c + 1)}>
            Clicked {count} {count === 1 ? 'time' : 'times'}
          </Button>
          <Button variant="secondary" onClick={() => setCount(0)}>
            Reset
          </Button>
        </div>
      </section>

      <Footer />
    </main>
  );
}
