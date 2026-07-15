import Dashboard from './pages/Dashboard'

export default function App() {
  return (
    <>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '14px 36px', borderBottom: '1px solid var(--border)', background: 'var(--card)',
      }}>
        <h1 style={{
          fontSize: 22, fontWeight: 800, color: 'var(--text)',
          letterSpacing: '-0.4px', textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          Smart Regression Optimizer
        </h1>
      </nav>
      <Dashboard />
    </>
  )
}
