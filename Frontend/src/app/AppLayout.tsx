import { useMemo, useState, useEffect, useRef } from 'react'
import { ControlsPanel } from '../features/controls/ControlsPanel'
import { MetricsDashboard } from '../features/metrics/MetricsDashboard'
import { ReportScreen } from '../features/report/ReportScreen'
import { HistoryScreen } from '../features/history/HistoryScreen'
import { AnimationScene } from '../features/animation/AnimationScene'
import { useSimulationStore } from '../state/simulationStore'
import type { SimulationReport } from '../types/simulation'
import './AppLayout.css'

const IS_ANIM = (tickMs: number) => tickMs === 1_620_000 || tickMs === 162_000

export function AppLayout() {
  const snapshot              = useSimulationStore((s) => s.snapshot)
  const isRunning             = useSimulationStore((s) => s.isRunning)
  const report                = useSimulationStore((s) => s.report)
  const dismissReport         = useSimulationStore((s) => s.dismissReport)
  const config                = useSimulationStore((s) => s.config)
  const revealNext            = useSimulationStore((s) => s.revealNextEvent)
  const revealIntervalMs      = useSimulationStore((s) => s.revealIntervalMs)
  const isPaused              = useSimulationStore((s) => s.isPaused)
  const reportHistory         = useSimulationStore((s) => s.reportHistory)
  const deleteReportFromHistory = useSimulationStore((s) => s.deleteReportFromHistory)
  const clearReportHistory    = useSimulationStore((s) => s.clearReportHistory)

  // Motor central de reveal — siempre activo independientemente del tab visible.
  const revealIntervalRef = useRef(revealIntervalMs)
  const isPausedRef       = useRef(isPaused)
  useEffect(() => { revealIntervalRef.current = revealIntervalMs }, [revealIntervalMs])
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])

  useEffect(() => {
    let lastReveal = 0
    const id = setInterval(() => {
      if (isPausedRef.current) return
      const now = Date.now()
      if (now - lastReveal >= revealIntervalRef.current) {
        lastReveal = now
        revealNext()
      }
    }, 50)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAnim = IS_ANIM(config.tickMs)

  const [activeTab, setActiveTab] = useState<'metrics' | 'animation'>('metrics')
  const [showHistory, setShowHistory] = useState(false)
  const [historyDetail, setHistoryDetail] = useState<SimulationReport | null>(null)

  // Force back to metrics if speed changes away from animation-eligible speeds
  useEffect(() => {
    if (!isAnim) setActiveTab('metrics')
  }, [isAnim])

  const effectiveTab = isAnim ? activeTab : 'metrics'

  const statusText = useMemo(
    () => (isRunning ? 'Simulación en ejecución' : 'Simulación detenida'),
    [isRunning],
  )

  // ── Pantalla: informe del historial ──────────────────────────────────────────
  if (historyDetail) {
    return (
      <ReportScreen
        report={historyDetail}
        onDismiss={() => setHistoryDetail(null)}
        backLabel="← Volver al historial"
      />
    )
  }

  // ── Pantalla: historial ───────────────────────────────────────────────────────
  if (showHistory) {
    return (
      <HistoryScreen
        history={reportHistory}
        onBack={() => setShowHistory(false)}
        onViewReport={(r) => setHistoryDetail(r)}
        onDelete={deleteReportFromHistory}
        onClearAll={clearReportHistory}
      />
    )
  }

  // ── Pantalla: informe de la simulación actual ─────────────────────────────────
  if (report) {
    return <ReportScreen report={report} onDismiss={dismissReport} />
  }

  // ── Pantalla principal ────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">TFI · Simulación de Colas</p>
          <h1>EMA S.R.L. — Planta de Reciclaje RAEE</h1>
        </div>
        <div className="app-header-right">
          <button
            type="button"
            className="history-nav-btn"
            onClick={() => setShowHistory(true)}
            title="Ver simulaciones anteriores"
          >
            Historial
            {reportHistory.length > 0 && (
              <span className="history-nav-badge">{reportHistory.length}</span>
            )}
          </button>
          <div className={`status-pill ${isRunning ? 'running' : 'stopped'}`}>
            {statusText}
          </div>
        </div>
      </header>

      <div className="main-layout">
        <ControlsPanel />

        <div className="content-area">
          {/* Tab bar */}
          <div className="tab-bar">
            <button
              className={`tab-btn ${effectiveTab === 'metrics' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('metrics')}
            >
              Métricas
            </button>
            <button
              className={`tab-btn ${effectiveTab === 'animation' ? 'tab-active' : ''} ${!isAnim ? 'tab-locked' : ''}`}
              onClick={() => { if (isAnim) setActiveTab('animation') }}
              disabled={!isAnim}
              title={!isAnim ? 'La pestaña de animación está disponible a 1× y ×10' : undefined}
            >
              Animación
              {!isAnim && <span className="tab-lock-badge">1× / ×10</span>}
            </button>
          </div>

          {/* Tab panels — ambos siempre montados para que la animación
               corra en segundo plano aunque el tab activo sea Métricas */}
          <div className="tab-panel">
            <div style={{ display: effectiveTab === 'metrics' ? undefined : 'none', height: '100%' }}>
              <MetricsDashboard snapshot={snapshot} />
            </div>
            <div style={{ display: effectiveTab === 'animation' ? undefined : 'none', height: '100%' }}>
              <AnimationScene />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
