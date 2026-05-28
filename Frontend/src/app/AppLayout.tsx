import { useMemo } from 'react'
import { ControlsPanel } from '../features/controls/ControlsPanel'
import { MetricsDashboard } from '../features/metrics/MetricsDashboard'
import { useSimulationStore } from '../state/simulationStore'
import './AppLayout.css'

export function AppLayout() {
  const snapshot  = useSimulationStore((s) => s.snapshot)
  const isRunning = useSimulationStore((s) => s.isRunning)

  const statusText = useMemo(
    () => (isRunning ? 'Simulación en ejecución' : 'Simulación detenida'),
    [isRunning],
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">TFI · Simulación de Colas</p>
          <h1>EMA S.R.L. — Planta de Reciclaje RAEE</h1>
        </div>
        <div className={`status-pill ${isRunning ? 'running' : 'stopped'}`}>
          {statusText}
        </div>
      </header>

      <div className="main-layout">
        <ControlsPanel />
        <div className="content-area">
          <MetricsDashboard snapshot={snapshot} />
        </div>
      </div>
    </div>
  )
}
