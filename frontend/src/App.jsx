import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import CoverageDashboard from './pages/CoverageDashboard'

const VIEWS = {
  'approach-1': { label: '📊 Component-Based (Approach 1)', Component: Dashboard },
  'approach-2': { label: '🔬 Coverage-Based TIA (Approach 2)', Component: CoverageDashboard },
}

export default function App() {
  const [view, setView] = useState('approach-1')
  const { Component } = VIEWS[view]

  return (
    <>
      <nav style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
        padding: '14px 36px', borderBottom: '1px solid var(--border)', background: 'var(--card)',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.entries(VIEWS).map(([key, { label }]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
                border: view === key ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                background: view === key ? 'var(--primary)' : 'var(--card)',
                color: view === key ? '#fff' : 'var(--text)',
                fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <h1 style={{
          fontSize: 22, fontWeight: 800, color: 'var(--text)',
          letterSpacing: '-0.4px', textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          Smart Regression Optimizer
        </h1>
        <div />
      </nav>
      <Component />
    </>
  )
}
