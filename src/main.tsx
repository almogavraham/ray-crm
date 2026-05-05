import { StrictMode, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  componentDidCatch(e: Error, i: ErrorInfo) { console.error('[RootBoundary]', e, i); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', direction: 'rtl', background: '#f8fafc', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>אירעה שגיאה בלתי צפויה</h2>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24, maxWidth: 360 }}>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()} style={{ background: '#3730a3', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            רענן את האפליקציה
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
