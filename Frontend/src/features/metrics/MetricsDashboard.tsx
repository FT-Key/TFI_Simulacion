import { Fragment, useEffect, useRef } from 'react'
import {
  Line, LineChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts'
import type { DeviceEvent, PlantSnapshot } from '../../types/simulation'
import { useSimulationStore } from '../../state/simulationStore'
import './MetricsDashboard.css'

/**
 * ms entre revelar cada evento.
 * Divisor 90 ≈ máx. eventos por tick de trabajo (triage + desguace).
 * Garantiza que el log "mantiene el ritmo" sin acumular cola.
 * Ejemplos: ×540 → 50 ms | ×60 → 300 ms | ×10 → 1 800 ms | 1× → 18 000 ms
 */
function eventRevealMs(tickMs: number): number {
  return Math.max(50, Math.floor(tickMs / 90))
}

const ARS = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-AR')

/** Convierte minutos desde medianoche a "HH:MM" en tiempo simulado. */
function simTimeStr(minutes?: number): string {
  if (minutes == null) return '--:--'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const TYPE_LABEL: Record<string, string> = {
  INKJET:     'Hogareña',
  LASER:      'Láser oficina',
  INDUSTRIAL: 'Industrial',
}

const TYPE_COLOR: Record<string, string> = {
  INKJET:     '#3aa1ff',
  LASER:      '#f2c744',
  INDUSTRIAL: '#e0754a',
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props { snapshot: PlantSnapshot }

export function MetricsDashboard({ snapshot }: Props) {
  const visibleEvents = useSimulationStore((s) => s.visibleEvents)
  const eventQueue    = useSimulationStore((s) => s.eventQueue)
  const revealNext    = useSimulationStore((s) => s.revealNextEvent)
  const isRunning     = useSimulationStore((s) => s.isRunning)
  const tickMs        = useSimulationStore((s) => s.config.tickMs)

  // Intervalo fijo que consume la cola de eventos de a uno.
  // setInterval es más robusto que setTimeout encadenado: no se cancela con cada
  // re-render y garantiza que el primer evento aparezca sin esperar una dependencia extra.
  useEffect(() => {
    const id = setInterval(revealNext, eventRevealMs(tickMs))
    return () => clearInterval(id)
  }, [revealNext, tickMs])

  // Auto-scroll del log al último evento
  const logEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleEvents.length])

  const series = snapshot.dailySeries.slice(-60)   // últimos 60 días para el gráfico

  return (
    <div className="metrics-root">

      {/* ── Fila superior: economía del día + acumulado ─────────────────── */}
      <div className="metrics-top-row">
        <EconomicsPanel snapshot={snapshot} isRunning={isRunning} />
        <QueuePanel snapshot={snapshot} />
        <StationsPanel snapshot={snapshot} />
      </div>

      {/* ── Fila central: log de dispositivos + gráfico ─────────────────── */}
      <div className="metrics-mid-row">

        {/* Log de dispositivos */}
        <article className="metric-card device-log-card">
          <header>
            <h3>Registro de dispositivos</h3>
            <span className="metric-sub">
              {visibleEvents.length > 0
                ? `${visibleEvents.length} eventos · ${eventQueue.length} pendientes`
                : 'Esperando inicio…'}
            </span>
          </header>
          <div className="device-log">
            {visibleEvents.map((ev, idx) => {
              const prevDay = idx > 0 ? visibleEvents[idx - 1].dayNumber : undefined
              const showDayHeader = ev.dayNumber != null && ev.dayNumber !== prevDay
              return (
                <Fragment key={`${ev.dayNumber ?? 0}-${ev.seq}`}>
                  {showDayHeader && <DayHeader day={ev.dayNumber!} />}
                  <DeviceEventRow event={ev} />
                </Fragment>
              )
            })}
            <div ref={logEndRef} />
          </div>
        </article>

        {/* Gráfico de cola y resultado neto */}
        <article className="metric-card chart-card">
          <header>
            <h3>Evolución diaria</h3>
            <span className="metric-sub">Últimos {series.length} días</span>
          </header>
          {series.length < 2 ? (
            <p className="no-data">Acumulando datos…</p>
          ) : (
            <div className="chart-group">
              {/* Cola */}
              <p className="chart-label">Cola de desguace (equipos)</p>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={series}>
                  <CartesianGrid stroke="#1a3260" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#89a8de" tick={{ fontSize: 9 }} interval={9} />
                  <YAxis stroke="#89a8de" tick={{ fontSize: 10 }} width={32} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#0c1f3d', border: '1px solid #2c5ea2', fontSize: 11 }}
                    formatter={(v: number) => [v, 'Equipos en cola']}
                  />
                  <ReferenceLine y={250} stroke="#e05050" strokeDasharray="4 2" label={{ value: 'Límite 250', fill: '#e05050', fontSize: 10 }} />
                  <Line type="monotone" dataKey="queueSize" stroke="#c96fd8" strokeWidth={2} dot={false} name="Cola" />
                </LineChart>
              </ResponsiveContainer>

              {/* Resultado neto */}
              <p className="chart-label">Resultado neto diario (ARS)</p>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={series}>
                  <CartesianGrid stroke="#1a3260" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#89a8de" tick={{ fontSize: 9 }} interval={9} />
                  <YAxis stroke="#89a8de" tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: '#0c1f3d', border: '1px solid #2c5ea2', fontSize: 11 }}
                    formatter={(v: number) => [ARS(v), 'Resultado']}
                  />
                  <ReferenceLine y={0} stroke="#555" />
                  <Line type="monotone" dataKey="dailyNetProfit" stroke="#2ad46f" strokeWidth={2} dot={false} name="Neto" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>
      </div>

    </div>
  )
}

// ── Panel economía ────────────────────────────────────────────────────────────

function EconomicsPanel({ snapshot, isRunning }: { snapshot: PlantSnapshot; isRunning: boolean }) {
  const netColor = snapshot.dailyNetProfit >= 0 ? '#2ad46f' : '#e05050'
  const totalColor = snapshot.totalNetProfit >= 0 ? '#2ad46f' : '#e05050'
  return (
    <article className="metric-card economics-card">
      <header>
        <h3>Economía</h3>
        {isRunning && <span className="live-dot" />}
      </header>

      <div className="econ-section">
        <p className="econ-section-title">Hoy</p>
        <EconRow label="Ingresos Caso A"  value={ARS(snapshot.dailyCaseARevenue)}   color="#3aa1ff" />
        <EconRow label="Ingresos materiales" value={ARS(snapshot.dailyMaterialRevenue)} color="#f2c744" />
        <EconRow label="Costo nómina"     value={`-${ARS(snapshot.dailyLaborCost)}`}   color="#e0754a" />
        {snapshot.dailySuspensionCost > 0 && (
          <EconRow label="Costo clausura" value={`-${ARS(snapshot.dailySuspensionCost)}`} color="#e05050" />
        )}
        <div className="econ-divider" />
        <EconRow label="Resultado neto"   value={ARS(snapshot.dailyNetProfit)}       color={netColor} bold />
      </div>

      <div className="econ-section">
        <p className="econ-section-title">Acumulado</p>
        <EconRow label="Ingresos totales" value={ARS(snapshot.totalCaseARevenue + snapshot.totalMaterialRevenue)} color="#89a8de" />
        <EconRow label="Costos totales"   value={`-${ARS(snapshot.totalLaborCost + snapshot.totalOpportunityCost + snapshot.totalLogisticCost)}`} color="#e0754a" />
        {snapshot.totalSuspensions > 0 && (
          <EconRow label="Suspensiones"   value={`${snapshot.totalSuspensions}x`}   color="#e05050" />
        )}
        <div className="econ-divider" />
        <EconRow label="Utilidad neta"    value={ARS(snapshot.totalNetProfit)}       color={totalColor} bold />
      </div>
    </article>
  )
}

function EconRow({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="econ-row">
      <span className="econ-label">{label}</span>
      <span className="econ-value" style={{ color, fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  )
}

// ── Panel cola ────────────────────────────────────────────────────────────────

function QueuePanel({ snapshot }: { snapshot: PlantSnapshot }) {
  const pct = Math.min(100, (snapshot.queueSize / 250) * 100)
  const fillColor = pct >= 90 ? '#e05050' : pct >= 60 ? '#f2c744' : '#2ad46f'
  return (
    <article className="metric-card queue-card">
      <header><h3>Cola de desguace</h3></header>
      <div className="queue-gauge">
        <div className="queue-bar-bg">
          <div className="queue-bar-fill" style={{ height: `${pct}%`, background: fillColor }} />
        </div>
        <div className="queue-numbers">
          <span className="queue-count" style={{ color: fillColor }}>{snapshot.queueSize}</span>
          <span className="queue-limit">/ 250</span>
        </div>
      </div>
      {snapshot.suspended && (
        <div className="queue-suspended">
          ⚠ Clausura<br />{snapshot.suspensionDaysRemaining}d restantes
        </div>
      )}
      <div className="queue-kpis">
        <MiniKpi label="Llegaron hoy"    value={snapshot.dailyArrivals}    />
        <MiniKpi label="Desarmados hoy"  value={snapshot.dailyDisassembled}/>
        <MiniKpi label="Caso A hoy"      value={snapshot.dailyCaseA}       />
        <MiniKpi label="Terminal hoy"    value={snapshot.dailyTerminalWaste}/>
      </div>
    </article>
  )
}

function MiniKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// ── Panel estaciones ──────────────────────────────────────────────────────────

function StationsPanel({ snapshot }: { snapshot: PlantSnapshot }) {
  return (
    <article className="metric-card stations-card">
      <header>
        <h3>Estaciones de desguace</h3>
        <span className="stations-today-badge">
          <strong>{snapshot.dailyDisassembled}</strong> hoy
        </span>
      </header>
      <div className="stations-list">
        {snapshot.stations.map((st) => (
          <div key={st.id} className="station-row">
            <span className="station-id">Est. {st.id}</span>
            <div className="station-bar-bg">
              <div
                className="station-bar-fill"
                style={{ width: `${st.utilizationPct}%` }}
              />
            </div>
            <span className="station-pct">{st.utilizationPct.toFixed(0)}%</span>
            <span className="station-count">{st.dailyCompleted} hoy</span>
          </div>
        ))}
      </div>
      <div className="station-totals">
        <span>Total desarmados: <strong>{snapshot.totalDisassembled.toLocaleString()}</strong></span>
      </div>
      <div className="material-mini">
        {Object.entries(snapshot.materialRecoveredKg).map(([mat, kg]) => (
          <div key={mat} className="mat-row">
            <span>{mat}</span>
            <strong>{Math.round(kg).toLocaleString()} kg</strong>
          </div>
        ))}
      </div>
    </article>
  )
}

// ── Encabezado de día en el log ───────────────────────────────────────────────

function DayHeader({ day }: { day: number }) {
  return (
    <div className="day-header">
      <span className="day-header-line" />
      <span className="day-header-label">DÍA {day} — INICIO JORNADA 08:00</span>
      <span className="day-header-line" />
    </div>
  )
}

// ── Fila del log de dispositivos ──────────────────────────────────────────────

function DeviceEventRow({ event }: { event: DeviceEvent }) {
  if (event.eventType === 'TRIAGE') {
    return <TriageRow event={event} />
  }
  return <DesguaceRow event={event} />
}

function TriageRow({ event }: { event: DeviceEvent }) {
  const result = event.triageResult!
  const resultConfig = {
    CASO_A:   { label: 'CASO A',   color: '#3aa1ff', bg: '#3aa1ff18' },
    TERMINAL: { label: 'TERMINAL', color: '#e05050', bg: '#e0505018' },
    CASO_B:   { label: 'COLA ↓',   color: '#f2c744', bg: '#f2c74418' },
  }[result]!

  return (
    <div className="dev-row triage-row" style={{ borderLeftColor: resultConfig.color }}>
      <span className="dev-seq">#{event.seq}</span>
      <span className="dev-time">{simTimeStr(event.simTimeMinutes)}</span>
      <span className="dev-phase">TRIAJE</span>
      {event.deviceType ? (
        <>
          <span className="dev-type" style={{ color: TYPE_COLOR[event.deviceType] }}>
            {TYPE_LABEL[event.deviceType]}
          </span>
          <span className="dev-weight">{event.weightKg?.toFixed(1)} kg</span>
        </>
      ) : (
        <span className="dev-type" style={{ color: '#89a8de' }}>—</span>
      )}
      <span
        className="dev-result"
        style={{ color: resultConfig.color, background: resultConfig.bg }}
      >
        {resultConfig.label}
      </span>
      {result === 'CASO_A' && event.caseARevenue != null && (
        <span className="dev-revenue" style={{ color: '#3aa1ff' }}>
          {ARS(event.caseARevenue)}
        </span>
      )}
    </div>
  )
}

function DesguaceRow({ event }: { event: DeviceEvent }) {
  const typeColor = TYPE_COLOR[event.deviceType ?? ''] ?? '#89a8de'
  const procMin   = event.processingTimeMinutes ?? 55
  const endMin    = event.simTimeMinutes
  const startMin  = endMin != null ? endMin - procMin : undefined

  return (
    <div className="dev-row desguace-row" style={{ borderLeftColor: '#2ad46f' }}>
      <span className="dev-seq">#{event.seq}</span>
      <span className="dev-time">{simTimeStr(endMin)}</span>
      <span className="dev-phase">DESGUACE</span>
      <span className="dev-type" style={{ color: typeColor }}>
        {TYPE_LABEL[event.deviceType ?? ''] ?? '—'}
      </span>
      <span className="dev-weight">{event.weightKg?.toFixed(1)} kg</span>
      <span className="dev-revenue" style={{ color: '#2ad46f' }}>
        {ARS(event.materialRevenue ?? 0)}
      </span>
      <span className="dev-disasm-times">
        <span className="disasm-start">▶ {simTimeStr(startMin)}</span>
        <span className="disasm-arrow">→</span>
        <span className="disasm-end">■ {simTimeStr(endMin)}</span>
        <span className="disasm-dur">({procMin.toFixed(0)} min)</span>
      </span>
      <span className="dev-materials">
        P:{event.plasticKg?.toFixed(1)} F:{event.ferrousKg?.toFixed(1)} M:{event.preciousKg?.toFixed(2)}
      </span>
    </div>
  )
}
