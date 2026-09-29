import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Shows a readable message instead of a blank page if something crashes.
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('IITH Pulse crashed:', error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        <div style={{ maxWidth: 560 }}>
          <p><span className="lambda">λ</span></p>
          <p><strong>Something went wrong while loading IITH Pulse.</strong></p>
          <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
          <p className="muted small">
            Most common cause: an older copy of the app is still running. Stop it (Ctrl + C in its terminal, or run{' '}
            <code>pkill -f "src/index.js"; pkill -f vite</code>), then run <code>npm run dev</code> again and open http://localhost:5173.
          </p>
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
