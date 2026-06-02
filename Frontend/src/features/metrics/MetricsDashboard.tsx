import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  Line, LineChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts'
import type { DeviceEvent, PlantSnapshot } from '../../types/simulation'
import { useSimulationStore } from '../../state/simulationStore'
import './MetricsDashboard.css'

const ARS = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-AR')

/** Convierte minutos desde medianoche a "HH:MM" en tiempo simulado. */
function simTimeStr(minutes?: number): string {
  if (minutes == null) return '--:--'
  const total = Math.round(minutes)   // redondear para evitar decimales del backend
  const h = Math.floor(total / 60)
  const m = total % 60
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

const MAT_COLORS: Record<string, string> = {
  plastico:  '#3aa1ff',
  ferroso:   '#89a8de',
  preciosos: '#f2c744',
  aluminio:  '#a8b5c9',
  cobre:     '#e0754a',
}

const MAT_LABELS: Record<string, string> = {
  plastico:  'Plástico',
  ferroso:   'Ferroso',
  preciosos: 'Preciosos',
  aluminio:  'Aluminio',
  cobre:     'Cobre',
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props { snapshot: PlantSnapshot }

export function MetricsDashboard({ snapshot }: Props) {
  const visibleEvents      = useSimulationStore((s) => s.visibleEvents)
  const eventQueue         = useSimulationStore((s) => s.eventQueue)
  const isRunning          = useSimulationStore((s) => s.isRunning)
  const config             = useSimulationStore((s) => s.config)

  // Auto-scroll del log al último evento — scrollTop instantáneo sobre el contenedor,
  // evita que las animaciones smooth se apilen a ×540 (33 ms entre eventos)
  const logContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleEvents.length])

  const series = snapshot.dailySeries.slice(-60)   // últimos 60 días para el gráfico

  // Utilidad acumulada: el último punto coincide con snapshot.totalNetProfit
  const seriesWithCum = useMemo(() => {
    const base = snapshot.totalNetProfit - series.reduce((s, p) => s + p.dailyNetProfit, 0)
    let cum = base
    return series.map((p) => ({ ...p, cumulativeProfit: (cum += p.dailyNetProfit) }))
  }, [series, snapshot.totalNetProfit])

  return (
    <div className="metrics-root">

      {/* ── Fila superior: economía del día + acumulado ─────────────────── */}
      <div className="metrics-top-row">
        <EconomicsPanel snapshot={snapshot} isRunning={isRunning} />
        <QueuePanel snapshot={snapshot} config={config} />
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
          <div className="device-log" ref={logContainerRef}>
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
              <ResponsiveContainer width="100%" height={105}>
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

              {/* Resultado neto DIARIO — barras verdes/rojas */}
              <p className="chart-label">Resultado neto por día (ARS)</p>
              <ResponsiveContainer width="100%" height={105}>
                <BarChart data={series} barCategoryGap="20%">
                  <CartesianGrid stroke="#1a3260" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#89a8de" tick={{ fontSize: 9 }} interval={9} />
                  <YAxis stroke="#89a8de" tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: '#0c1f3d', border: '1px solid #2c5ea2', fontSize: 11 }}
                    formatter={(v: number) => [ARS(v), 'Neto del día']}
                  />
                  <ReferenceLine y={0} stroke="#334d6e" />
                  <Bar dataKey="dailyNetProfit" radius={[2, 2, 0, 0]} maxBarSize={18}>
                    {series.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.dailyNetProfit >= 0 ? '#2ad46f' : '#e05050'}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Utilidad acumulada — línea total */}
              <p className="chart-label">Utilidad neta acumulada (ARS)</p>
              <ResponsiveContainer width="100%" height={105}>
                <LineChart data={seriesWithCum}>
                  <CartesianGrid stroke="#1a3260" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#89a8de" tick={{ fontSize: 9 }} interval={9} />
                  <YAxis stroke="#89a8de" tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: '#0c1f3d', border: '1px solid #2c5ea2', fontSize: 11 }}
                    formatter={(v: number) => [ARS(v), 'Acumulado']}
                  />
                  <ReferenceLine y={0} stroke="#334d6e" />
                  <Line type="monotone" dataKey="cumulativeProfit" stroke="#7bc8f5" strokeWidth={2} dot={false} name="Acumulado" />
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
        {snapshot.dailyOpportunityInfo > 0 && (
          <EconRow label="Ingreso potencial perdido" value={ARS(snapshot.dailyOpportunityInfo)} color="#a0a0a0" />
        )}
        <div className="econ-divider" />
        <EconRow label="Resultado neto"   value={ARS(snapshot.dailyNetProfit)}       color={netColor} bold />
      </div>

      <div className="econ-section">
        <p className="econ-section-title">Acumulado</p>
        <EconRow label="Ingresos totales" value={ARS(snapshot.totalCaseARevenue + snapshot.totalMaterialRevenue)} color="#89a8de" />
        <EconRow label="Costos totales"   value={`-${ARS(snapshot.totalLaborCost + snapshot.totalLogisticCost)}`} color="#e0754a" />
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

function QueuePanel({ snapshot, config }: { snapshot: PlantSnapshot; config: import('../../types/simulation').SimulationConfig }) {
  const pct = Math.min(100, (snapshot.queueSize / 250) * 100)
  const fillColor = pct >= 90 ? '#e05050' : pct >= 60 ? '#f2c744' : '#2ad46f'

  // El queueSize incluye tanto los que esperan como los que están siendo desarmados
  // (el evento DESGUACE llega al final del proceso, no al inicio).
  // Estimamos cuántos están en proceso según la capacidad concurrente configurada.
  const maxConcurrent = config.activeStations * config.operatorsPerStation
  const inProcess     = Math.min(snapshot.queueSize, maxConcurrent)
  const waiting       = Math.max(0, snapshot.queueSize - inProcess)

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

      {/* Desglose: en espera vs siendo desarmados ahora */}
      {snapshot.queueSize > 0 && (
        <div className="queue-breakdown">
          <div className="qb-row">
            <span className="qb-dot qb-dot--wait" />
            <span className="qb-label">En espera</span>
            <strong className="qb-val">{waiting}</strong>
          </div>
          <div className="qb-row">
            <span className="qb-dot qb-dot--proc" />
            <span className="qb-label">Desarmando ahora</span>
            <strong className="qb-val qb-val--proc">{inProcess}</strong>
          </div>
        </div>
      )}

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

// ── Gráfico de torta de materiales ────────────────────────────────────────────

function MaterialsPieChart({ materialKg }: { materialKg: Record<string, number> }) {
  const entries = Object.entries(materialKg).filter(([, kg]) => kg > 0)

  if (entries.length === 0) {
    return <p className="no-data" style={{ fontSize: 10, padding: '6px 0' }}>Sin materiales aún</p>
  }

  const data  = entries.map(([key, kg]) => ({ key, kg: Math.round(kg) }))
  const total = data.reduce((s, d) => s + d.kg, 0)

  return (
    <div className="mat-pie-wrap">
      {/* Columna izquierda: donut chart en su propio contenedor de ancho fijo */}
      <div className="mat-pie-chart-area">
        <PieChart width={110} height={110}>
          <Pie
            data={data}
            dataKey="kg"
            cx={55}
            cy={55}
            innerRadius={30}
            outerRadius={50}
            paddingAngle={3}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={MAT_COLORS[d.key] ?? '#4a6fa5'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#0c1f3d', border: '1px solid #2c5ea2', fontSize: 10 }}
            formatter={(v: number, _n: string, props: { payload?: { key?: string } }) => [
              `${v.toLocaleString()} kg`,
              MAT_LABELS[props.payload?.key ?? ''] ?? props.payload?.key ?? '',
            ]}
          />
        </PieChart>
      </div>

      {/* Columna derecha: leyenda */}
      <div className="mat-pie-legend">
        {data.map((d) => (
          <div key={d.key} className="mat-pie-row">
            <span className="mat-pie-dot" style={{ background: MAT_COLORS[d.key] ?? '#4a6fa5' }} />
            <span className="mat-pie-name">{MAT_LABELS[d.key] ?? d.key}</span>
            <span className="mat-pie-val">{d.kg.toLocaleString()} kg</span>
            <span className="mat-pie-pct">{total > 0 ? Math.round((d.kg / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
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
          </div>
        ))}
      </div>
      <div className="station-totals">
        <span>Total desarmados: <strong>{snapshot.totalDisassembled.toLocaleString()}</strong></span>
      </div>
      <MaterialsPieChart materialKg={snapshot.materialRecoveredKg} />
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
  if (event.eventType === 'ARRIVALS')        return <ArrivalsRow event={event} />
  if (event.eventType === 'DAY_END')         return <DayEndRow event={event} />
  if (event.eventType === 'OPPORTUNITY_INFO') return <OpportunityInfoRow event={event} />
  if (event.eventType === 'SUSPENSION_END')  return <SuspensionEndRow event={event} />
  if (event.eventType === 'TRIAGE_SUMMARY')  return <TriageSummaryRow event={event} />
  if (event.eventType === 'TRIAGE')          return <TriageRow event={event} />
  return <DesguaceRow event={event} />
}

function DayEndRow({ event }: { event: DeviceEvent }) {
  const tickMs  = useSimulationStore((s) => s.config.tickMs)
  const pausing = (tickMs === 1_620_000 || tickMs === 162_000) && event.workDay !== false
  if (event.workDay === false) return null   // días no laborables: sin banner de cierre
  return (
    <div className="day-end-row">
      <span className="day-end-icon">🏁</span>
      <span className="day-end-text">
        Jornada del día <strong>{event.dayNumber}</strong> finalizada — 17:00
      </span>
      {pausing && <span className="day-end-pause">Próximo día en 10 s…</span>}
    </div>
  )
}

function ArrivalsRow({ event }: { event: DeviceEvent }) {
  if (event.workDay === false) {
    const isHoliday = !!event.holidayName
    return (
      <div className={`arrivals-row non-work${isHoliday ? ' holiday' : ''}`}>
        <span className="arrivals-icon">{isHoliday ? '🏛' : '🔒'}</span>
        <span className="arrivals-text">
          Planta cerrada —{' '}
          {isHoliday
            ? <strong className="holiday-name">{event.holidayName}</strong>
            : 'fin de semana'}
        </span>
      </div>
    )
  }
  if (event.suspended) {
    return (
      <div className="arrivals-row suspended">
        <span className="arrivals-icon">🚫</span>
        <span className="arrivals-text">Sin recepción de dispositivos — planta bajo clausura</span>
      </div>
    )
  }
  return (
    <div className="arrivals-row">
      <span className="arrivals-icon">📦</span>
      <span className="arrivals-text">
        <strong>{event.arrivalsCount}</strong> dispositivos ingresaron hoy
      </span>
      <span className="arrivals-time">08:00 — apertura de planta</span>
    </div>
  )
}

function OpportunityInfoRow({ event }: { event: DeviceEvent }) {
  const daysLeft  = event.suspensionDaysLeft ?? 0
  const dayNumber = 8 - daysLeft   // día 1 cuando daysLeft=7, día 7 cuando daysLeft=1
  return (
    <div className="suspension-day-row opportunity-info-row">
      <span className="susp-icon">💡</span>
      <span className="susp-label">
        Clausura · Día <strong>{dayNumber}</strong> de 7 — sin recepción
      </span>
      <span className="susp-cost susp-cost--info">
        Se podría haber ganado: <strong>{ARS(event.opportunityAmount ?? 0)}</strong>
      </span>
    </div>
  )
}

function TriageSummaryRow({ event }: { event: DeviceEvent }) {
  const leftover = event.triageLeftover ?? 0
  return (
    <div className="triage-summary-row">
      <span className="ts-icon">📋</span>
      <span className="ts-body">
        <strong>Resumen triaje</strong>
        {' — '}Hoy: <strong>{event.triageNewArrivals}</strong>
        {(event.triagePendingFromYesterday ?? 0) > 0 && (
          <> · Del día anterior: <strong>{event.triagePendingFromYesterday}</strong></>
        )}
        {' · '}Total: <strong>{event.triageTotalToClassify}</strong>
        {' · '}Clasificados: <strong>{event.triageClassified}</strong>
        {leftover > 0
          ? <span className="ts-leftover"> · ⚠ <strong>{leftover}</strong> pasan al día siguiente</span>
          : <span className="ts-ok"> · ✔ Cola de triaje evacuada</span>
        }
      </span>
    </div>
  )
}

function SuspensionEndRow({ event }: { event: DeviceEvent }) {
  return (
    <div className="suspension-end-row">
      <span className="susp-icon">🚨</span>
      <span className="susp-label">Clausura finalizada — cargo logístico fijo</span>
      <span className="susp-cost susp-cost--fixed">
        <strong>−{ARS(event.suspensionPenalty ?? 0)}</strong>
      </span>
    </div>
  )
}

function TriageRow({ event }: { event: DeviceEvent }) {
  const result = event.triageResult!
  const resultConfig = {
    CASO_A:   { label: 'CASO A',   color: '#3aa1ff', bg: '#3aa1ff18' },
    TERMINAL: { label: 'TERMINAL', color: '#e05050', bg: '#e0505018' },
    CASO_B:   { label: 'COLA ↓',   color: '#f2c744', bg: '#f2c74418' },
  }[result]!

  // Solo los Caso B van a la cola de desguace y recibirán una referencia posterior
  const isCaseB = result === 'CASO_B'

  return (
    <div className="dev-row triage-row" style={{ borderLeftColor: resultConfig.color }}>
      {isCaseB
        ? <span className="dev-seq">#{event.caseBNum}</span>
        : <span className="dev-seq dev-seq--no-ref" />
      }
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
      <span className="dev-seq">#{event.caseBNum}</span>
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
