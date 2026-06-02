import type { SimulationReport } from '../../types/simulation'
import './ReportScreen.css'

interface Props {
  report: SimulationReport
  onDismiss: () => void
  backLabel?: string
}

const ARS = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-AR')

const KG = (n: number) =>
  (Math.round(n * 10) / 10).toLocaleString('es-AR') + ' kg'

const PCT = (n: number) =>
  (Math.round(n * 10) / 10).toFixed(1) + '%'

const MONTH_FULL = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function ReportScreen({ report, onDismiss, backLabel = '← Volver al dashboard' }: Props) {
  const {
    config, source,
    totalArrived, totalCaseA, totalTerminalWaste, totalCaseB, totalDisassembled, totalSuspensions,
    totalCaseARevenue, totalMaterialRevenue, totalLaborCost,
    totalOpportunityCost, totalLogisticCost, totalNetProfit,
    materialRecoveredKg, kpis, stations, monthlySeries,
  } = report

  const totalRevenue = totalCaseARevenue + totalMaterialRevenue
  const totalCost    = totalLaborCost + totalLogisticCost  // opportunity es informativo, no se resta
  const totalOps     = config.triageOperators + config.activeStations * config.operatorsPerStation

  // Para barras de la tabla mensual
  const maxAbsNetProfit = Math.max(...monthlySeries.map((m) => Math.abs(m.netProfit)), 1)

  return (
    <div className="report-shell">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="report-header">
        <div className="report-header-left">
          <p className="report-eyebrow">TFI · Simulación de Colas</p>
          <h1>Informe Final — EMA S.R.L. Planta de Reciclaje RAEE</h1>
          <p className="report-meta">
            {config.simulationDurationYears} {config.simulationDurationYears === 1 ? 'año' : 'años'} simulado{config.simulationDurationYears > 1 ? 's' : ''} ·{' '}
            {config.triageOperators} op. triaje · {config.activeStations} estaciones · {config.operatorsPerStation} op/est · {totalOps} operarios totales
            {source === 'computed' && <span className="report-source-badge"> · Corrida de referencia</span>}
          </p>
        </div>
        <button type="button" className="report-back-btn" onClick={onDismiss}>
          {backLabel}
        </button>
      </header>

      <div className="report-body">

        {/* ── KPIs principales ────────────────────────────────────────────── */}
        <section className="report-section">
          <h2>Resumen ejecutivo</h2>
          <div className="kpi-grid">
            <KpiCard label="Equipos recibidos"   value={totalArrived.toLocaleString('es-AR')} />
            <KpiCard label="Caso A (reventa)"    value={totalCaseA.toLocaleString('es-AR')}   sub={PCT(kpis?.caseAPct ?? 0)} />
            <KpiCard label="Residuo terminal"    value={totalTerminalWaste.toLocaleString('es-AR')} sub={PCT(kpis?.terminalWastePct ?? 0)} color="warn" />
            <KpiCard label="Desarmados"          value={totalDisassembled.toLocaleString('es-AR')} sub={PCT(kpis?.disassemblyPct ?? 0)} />
            <KpiCard label="Cola promedio"       value={PCT(kpis?.queueUtilizationPct ?? 0)}  sub="utilización / 250" />
            <KpiCard label="Clausuras"            value={String(totalSuspensions)} sub="eventos · 7 días c/u" color={totalSuspensions > 0 ? 'warn' : 'ok'} />
          </div>
        </section>

        {/* ── Economía ────────────────────────────────────────────────────── */}
        <section className="report-section">
          <h2>Economía</h2>
          <div className="economy-grid">
            <div className="economy-block">
              <h3>Ingresos</h3>
              <div className="economy-row">
                <span>Caso A (reventa)</span>
                <span className="pos">{ARS(totalCaseARevenue)}</span>
              </div>
              <div className="economy-row">
                <span>Materiales recuperados</span>
                <span className="pos">{ARS(totalMaterialRevenue)}</span>
              </div>
              <div className="economy-row total">
                <span>Total ingresos</span>
                <span className="pos">{ARS(totalRevenue)}</span>
              </div>
            </div>

            <div className="economy-block">
              <h3>Costos</h3>
              <div className="economy-row">
                <span>Nómina laboral</span>
                <span className="neg">{ARS(totalLaborCost)}</span>
              </div>
              <div className="economy-row">
                <span>Cargos logísticos</span>
                <span className="neg">{ARS(totalLogisticCost)}</span>
              </div>
              <div className="economy-row total">
                <span>Total costos</span>
                <span className="neg">{ARS(totalCost)}</span>
              </div>
            </div>

            <div className="economy-block highlight">
              <h3>Resultado neto</h3>
              <div className={`net-profit-big ${totalNetProfit >= 0 ? 'pos' : 'neg'}`}>
                {ARS(totalNetProfit)}
              </div>
              <p className="net-hint">
                {totalNetProfit >= 0 ? 'Operación rentable' : 'Operación deficitaria'}
              </p>
              {totalOpportunityCost > 0 && (
                <div className="economy-row opportunity-info-row">
                  <span>Ingreso potencial no percibido (informativo)</span>
                  <span className="info">{ARS(totalOpportunityCost)}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Materiales ──────────────────────────────────────────────────── */}
        <section className="report-section">
          <h2>Materiales recuperados</h2>
          <div className="materials-grid">
            <MaterialCard label="Plástico"  kg={materialRecoveredKg['plastico']  ?? 0} color="#60a5fa" />
            <MaterialCard label="Ferroso"   kg={materialRecoveredKg['ferroso']   ?? 0} color="#fb923c" />
            <MaterialCard label="Preciosos" kg={materialRecoveredKg['preciosos'] ?? 0} color="#facc15" />
            <MaterialCard label="Aluminio"  kg={materialRecoveredKg['aluminio']  ?? 0} color="#a78bfa" />
            <MaterialCard label="Cobre"     kg={materialRecoveredKg['cobre']     ?? 0} color="#f97316" />
          </div>
        </section>

        {/* ── Estaciones ──────────────────────────────────────────────────── */}
        {stations && stations.length > 0 && (
          <section className="report-section">
            <h2>Estaciones de desguace</h2>
            <div className="stations-grid">
              {stations.map((st) => (
                <div key={st.id} className="station-card">
                  <div className="station-title">Est. {st.id}</div>
                  <div className="station-util-bar">
                    <div
                      className="station-util-fill"
                      style={{ width: `${Math.min(100, st.utilizationPct ?? 0)}%` }}
                    />
                  </div>
                  <div className="station-util-label">{PCT(st.utilizationPct ?? 0)}</div>
                  <div className="station-detail">{st.totalCompletedDevices} equipos</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Mes a mes ───────────────────────────────────────────────────── */}
        <section className="report-section">
          <h2>Detalle mensual</h2>
          <div className="monthly-table-wrap">
            <table className="monthly-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Días háb.</th>
                  <th>Clausura<br/><span style={{fontSize:'10px',opacity:.6}}>días háb.</span></th>
                  <th>Llegaron</th>
                  <th>Caso A</th>
                  <th>Terminal</th>
                  <th>Desarmados</th>
                  <th>Cola prom.</th>
                  <th>Ingresos</th>
                  <th>Costos</th>
                  <th>Resultado</th>
                  <th className="bar-col">Comparativo<br/><span style={{fontSize:'10px',opacity:.6}}>vs. peor mes</span></th>
                </tr>
              </thead>
              <tbody>
                {monthlySeries.map((m) => {
                  const barPct = Math.round((Math.abs(m.netProfit) / maxAbsNetProfit) * 100)
                  return (
                    <tr key={`${m.yearIndex}-${m.month}`}>
                      <td className="month-label">{m.label}</td>
                      <td>{m.workDays}</td>
                      <td className={m.suspensionDays > 0 ? 'warn-cell' : ''}>
                        {m.suspensionDays > 0 ? m.suspensionDays : '—'}
                      </td>
                      <td>{m.arrivals}</td>
                      <td>{m.caseA}</td>
                      <td>{m.terminalWaste}</td>
                      <td>{m.disassembled}</td>
                      <td>{Math.round(m.avgQueueSize)}</td>
                      <td className="pos">{ARS(m.revenue)}</td>
                      <td className="neg">{ARS(m.cost)}</td>
                      <td className={m.netProfit >= 0 ? 'pos' : 'neg'}>{ARS(m.netProfit)}</td>
                      <td className="bar-col">
                        <div className="bar-wrap">
                          <div
                            className={`bar-fill ${m.netProfit >= 0 ? 'pos' : 'neg'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color?: 'ok' | 'warn' }) {
  return (
    <div className={`kpi-card${color ? ` kpi-${color}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

function MaterialCard({ label, kg, color }: { label: string; kg: number; color: string }) {
  return (
    <div className="material-card">
      <div className="material-dot" style={{ background: color }} />
      <div className="material-label">{label}</div>
      <div className="material-kg">{KG(kg)}</div>
    </div>
  )
}
