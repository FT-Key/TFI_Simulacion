import type { SavedReport, SimulationReport } from '../../types/simulation'
import './HistoryScreen.css'

interface Props {
  history: SavedReport[]
  onBack: () => void
  onViewReport: (report: SimulationReport) => void
  onDelete: (id: string) => void
  onClearAll: () => void
}

const ARS = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function HistoryScreen({ history, onBack, onViewReport, onDelete, onClearAll }: Props) {
  return (
    <div className="history-shell">
      <header className="history-header">
        <div className="history-header-left">
          <p className="history-eyebrow">TFI · Simulación de Colas</p>
          <h1>Historial de simulaciones</h1>
          <p className="history-meta">
            {history.length === 0
              ? 'Sin registros guardados'
              : `${history.length} ${history.length === 1 ? 'simulación guardada' : 'simulaciones guardadas'}`}
          </p>
        </div>
        <div className="history-header-actions">
          {history.length > 0 && (
            <button
              type="button"
              className="history-clear-btn"
              onClick={() => {
                if (window.confirm('¿Eliminar todo el historial?')) onClearAll()
              }}
            >
              Borrar todo
            </button>
          )}
          <button type="button" className="history-back-btn" onClick={onBack}>
            ← Volver al dashboard
          </button>
        </div>
      </header>

      <div className="history-body">
        {history.length === 0 ? (
          <div className="history-empty">
            <p>Todavía no hay simulaciones guardadas.</p>
            <p className="history-empty-hint">
              Los informes se guardan automáticamente al finalizar cada corrida.
            </p>
          </div>
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                onView={() => onViewReport(entry.report)}
                onDelete={() => onDelete(entry.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tarjeta de cada entrada ───────────────────────────────────────────────────

function HistoryCard({
  entry,
  onView,
  onDelete,
}: {
  entry: SavedReport
  onView: () => void
  onDelete: () => void
}) {
  const { report, savedAt } = entry
  const { config, totalNetProfit, totalArrived, totalDisassembled, source } = report
  const totalOps = config.triageOperators + config.activeStations * config.operatorsPerStation

  return (
    <div className="history-card">
      <div className="history-card-date">{formatDate(savedAt)}</div>

      <div className="history-card-body">
        <div className="history-card-config">
          <span className="hc-badge">
            {config.simulationDurationYears} {config.simulationDurationYears === 1 ? 'año' : 'años'}
          </span>
          <span className="hc-badge">{config.triageOperators} op. triaje</span>
          <span className="hc-badge">{config.activeStations} estaciones</span>
          <span className="hc-badge">{config.operatorsPerStation} op/est</span>
          <span className="hc-badge">{totalOps} operarios</span>
          {source === 'computed' && (
            <span className="hc-badge hc-badge-computed">Corrida finalizada</span>
          )}
        </div>

        <div className="history-card-stats">
          <div className="hc-stat">
            <span className="hc-stat-label">Equipos recibidos</span>
            <span className="hc-stat-value">{totalArrived.toLocaleString('es-AR')}</span>
          </div>
          <div className="hc-stat">
            <span className="hc-stat-label">Desarmados</span>
            <span className="hc-stat-value">{totalDisassembled.toLocaleString('es-AR')}</span>
          </div>
          <div className="hc-stat hc-stat-net">
            <span className="hc-stat-label">Resultado neto</span>
            <span className={`hc-stat-net-value ${totalNetProfit >= 0 ? 'pos' : 'neg'}`}>
              {ARS(totalNetProfit)}
            </span>
          </div>
        </div>
      </div>

      <div className="history-card-actions">
        <button type="button" className="hc-view-btn" onClick={onView}>
          Ver informe completo
        </button>
        <button
          type="button"
          className="hc-delete-btn"
          onClick={onDelete}
          title="Eliminar este registro"
        >
          Eliminar
        </button>
      </div>
    </div>
  )
}
