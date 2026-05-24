import { useState } from 'react';
import './App.css';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Hello from React</h1>
      <p>Edit <code>src/App.tsx</code> and save to see your changes.</p>
      <button onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}
