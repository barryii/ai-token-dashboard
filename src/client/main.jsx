import { createRoot } from 'react-dom/client';
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from './shared/theme.js';
import { setDisplayTimeZone } from './shared/display-time.js';

const App = lazy(() => import('./dashboard/App.jsx').then(module => ({ default: module.App })));
const ReviewApp = lazy(() => import('./review/ReviewApp.jsx').then(module => ({ default: module.ReviewApp })));

class PageBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert">頁面載入失敗。<button onClick={() => window.location.reload()}>重新載入</button></p> : this.props.children;
  }
}

function Root() {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetch('/api/config', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      if (controller.signal.aborted) return;
      setDisplayTimeZone(config.displayTimeZone);
      setStatus('ready');
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [attempt]);
  if (status === 'loading') return <p role="status">正在載入展示設定…</p>;
  if (status === 'error') return <p role="alert">展示設定載入失敗。<button onClick={() => setAttempt(value => value + 1)}>重試</button></p>;

  if (window.location.pathname === '/review') {
    document.title = 'AI Token 複盤 · Token Studio';
    return <ReviewApp />;
  }

  document.title = 'Token Studio · AI Token Dashboard';
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <MotionConfig reducedMotion="user">
      <PageBoundary><Suspense fallback={<p role="status">正在載入頁面…</p>}><Root /></Suspense></PageBoundary>
    </MotionConfig>
  </ThemeProvider>
);
