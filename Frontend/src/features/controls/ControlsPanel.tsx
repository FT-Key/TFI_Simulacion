import { useMemo, useState } from 'react'
import type { SimulationConfig } from '../../types/simulation'
import { useSimulationStore } from '../../state/simulationStore'
import './ControlsPanel.css'

const LIMITS = {
  triageOperators:     { min: 1, max: 4 },
  activeStations:      { min: 1, max: 6 },
  operatorsPerStation: { min: 1, max: 4 },
}

/** 1 hora simulada = 3 min reales → 1 día simulado (9 h) = 27 min reales = 1 620 000 ms */
const BASE_TICK_MS = 1_620_000

const SPEED_OPTIONS = [
  { label: '1×',   tickMs: 1_620_000, hint: '1 h sim = 3 min' },
  { label: '×10',  tickMs: 162_000,   hint: '1 h sim = 18 seg' },
  { label: '×60',  tickMs: 27_000,    hint: '1 h sim = 3 seg' },
  { label: '×540', tickMs: 3_000,     hint: 'Año en ~18 min' },
] as const

function formatYearDuration(tickMs: number): string {
  const totalMin = (tickMs * 365) / 60_000
  if (totalMin < 60)       return `~${Math.round(totalMin)} min`
  if (totalMin < 24 * 60)  return `~${(totalMin / 60).toFixed(1)} h`
  return `~${(totalMin / 60 / 24).toFixed(1)} días`
}

const MONTH_NAMES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const DAY_NAMES = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function ControlsPanel() {
  const config              = useSimulationStore((s) => s.config)
  const isRunning           = useSimulationStore((s) => s.isRunning)
  const isPaused            = useSimulationStore((s) => s.isPaused)
  const snapshot            = useSimulationStore((s) => s.snapshot)
  const isComputingReport   = useSimulationStore((s) => s.isComputingReport)
  const startSimulation     = useSimulationStore((s) => s.startSimulation)
  const stopSimulation      = useSimulationStore((s) => s.stopSimulation)
  const pauseSimulation     = useSimulationStore((s) => s.pauseSimulation)
  const resumeSimulation    = useSimulationStore((s) => s.resumeSimulation)
  const applyConfig         = useSimulationStore((s) => s.applyConfig)
  const resetSimulation     = useSimulationStore((s) => s.resetSimulation)
  const computeReport       = useSimulationStore((s) => s.computeReport)

  const [draft, setDraft] = useState<SimulationConfig>(config)

  const isDirty = useMemo(
    () =>
      draft.triageOperators         !== config.triageOperators        ||
      draft.activeStations          !== config.activeStations         ||
      draft.operatorsPerStation     !== config.operatorsPerStation    ||
      draft.simulationDurationYears !== config.simulationDurationYears ||
      draft.tickMs                  !== config.tickMs,
    [draft, config],
  )

  const isCompleted = snapshot.isCompleted

  // Costo laboral diario estimado (preview en tiempo real)
  const dailyLaborPreview =
    (draft.triageOperators + draft.activeStations * draft.operatorsPerStation) * 9 * 5_000

  // Capacidad de desensamblaje diaria estimada (en dispositivos)
  const avgProcMin = 0.30 * 49 + 0.50 * 55 + 0.20 * 71.5   // ~57.5 min promedio ponderado
  const dailyCapacity = Math.floor(
    (draft.activeStations * draft.operatorsPerStation * 540) / avgProcMin
  )

  return (
    <aside className="controls-panel">
      <h2>Configuración</h2>
      <p className="controls-subtitle">
        Escenario operativo · 1 año · Lunes–Viernes 8-17 h
      </p>

      {/* ── Personal de triaje ──────────────────────────────────── */}
      <RangeInput
        label="Operarios de triaje"
        value={draft.triageOperators}
        min={LIMITS.triageOperators.min}
        max={LIMITS.triageOperators.max}
        hint="Clasifican equipos al llegar. Costo: 9 h × $5 000/h c/u."
        onChange={(v) => setDraft((p) => ({ ...p, triageOperators: v }))}
        disabled={isRunning}
      />

      {/* ── Estaciones de desguace ──────────────────────────────── */}
      <RangeInput
        label="Estaciones de desguace"
        value={draft.activeStations}
        min={LIMITS.activeStations.min}
        max={LIMITS.activeStations.max}
        hint="Canales paralelos de desensamblaje (M/G/c)."
        onChange={(v) => setDraft((p) => ({ ...p, activeStations: v }))}
        disabled={isRunning}
      />

      {/* ── Operarios por estación ──────────────────────────────── */}
      <RangeInput
        label="Operarios / estación"
        value={draft.operatorsPerStation}
        min={LIMITS.operatorsPerStation.min}
        max={LIMITS.operatorsPerStation.max}
        hint="Cada operario agrega 540 min de capacidad a la estación."
        onChange={(v) => setDraft((p) => ({ ...p, operatorsPerStation: v }))}
        disabled={isRunning}
      />

      {/* ── Preview de capacidad ────────────────────────────────── */}
      <div className="capacity-preview">
        <div className="cap-row">
          <span>Capacidad desguace/día</span>
          <strong>~{dailyCapacity} equipos</strong>
        </div>
        <div className="cap-row">
          <span>Costo nómina/día</span>
          <strong>${dailyLaborPreview.toLocaleString('es-AR')}</strong>
        </div>
        <div className="cap-row muted">
          <span>Total operarios</span>
          <strong>{draft.triageOperators + draft.activeStations * draft.operatorsPerStation}</strong>
        </div>
      </div>

      {/* ── Duración ────────────────────────────────────────────── */}
      <div className="control-group">
        <span className="control-group-label">Duración de la corrida</span>
        <div className="btn-group">
          {([1, 2] as const).map((y) => (
            <button
              key={y}
              type="button"
              className={`btn-group-item${draft.simulationDurationYears === y ? ' active' : ''}`}
              onClick={() => setDraft((p) => ({ ...p, simulationDurationYears: y }))}
              disabled={isRunning}
            >
              {y} {y === 1 ? 'año' : 'años'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Velocidad ───────────────────────────────────────────── */}
      <div className="control-group">
        <span className="control-group-label">
          Velocidad · año en {formatYearDuration(draft.tickMs)}
        </span>
        <div className="btn-group">
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`btn-group-item${draft.tickMs === opt.tickMs ? ' active' : ''}`}
              onClick={() => setDraft((p) => ({ ...p, tickMs: opt.tickMs }))}
              disabled={isRunning}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <small className="range-hint">
          {SPEED_OPTIONS.find((o) => o.tickMs === draft.tickMs)?.hint
            ?? `${(BASE_TICK_MS / draft.tickMs).toFixed(0)}× velocidad base`}
        </small>
      </div>

      {/* ── Acciones ────────────────────────────────────────────── */}
      <div className="controls-actions">
        <button
          type="button"
          onClick={() => applyConfig(draft)}
          disabled={!isDirty || isRunning}
        >
          Aplicar cambios
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => resetSimulation()}
        >
          Reiniciar
        </button>
      </div>

      {/* ── Progreso ─────────────────────────────────────────────── */}
      {(isRunning || snapshot.currentDay > 0) && (
        <div className="run-progress">
          <div className="run-day-info">
            <span className="run-day-label">Día {snapshot.currentDay} / 365</span>
            <span className={`run-day-name${snapshot.workDay ? '' : ' weekend'}`}>
              {DAY_NAMES[snapshot.dayOfWeek]}
            </span>
            {snapshot.dayOfMonth > 0 && (
              <span className="day-of-month-badge">{snapshot.dayOfMonth}</span>
            )}
            <span className={`month-badge${snapshot.peakMonth ? ' peak' : ''}`}>
              {MONTH_NAMES[snapshot.currentMonth]}
              {snapshot.peakMonth && ' ★'}
            </span>
          </div>
          <div className="run-day-bar">
            <div
              className="run-day-fill"
              style={{ width: `${(snapshot.currentDay / 365) * 100}%` }}
            />
          </div>
          {isPaused && (
            <div className="paused-badge">⏸ Simulación pausada</div>
          )}
          {snapshot.holidayName && (
            <div className="holiday-badge">🏛 {snapshot.holidayName}</div>
          )}
          {snapshot.suspended && (
            <div className="suspension-badge">
              ⚠ CLAUSURA — {snapshot.suspensionDaysRemaining} días restantes
            </div>
          )}
          {isCompleted && <div className="completed-badge">✓ Corrida completada</div>}
        </div>
      )}

      {/* ── Iniciar / pausar / detener ───────────────────────────── */}
      <div className="run-actions">
        {!isRunning ? (
          <button
            type="button"
            className="success"
            onClick={() => startSimulation(draft)}
            disabled={isCompleted}
          >
            {isCompleted ? 'Corrida completada' : 'Iniciar simulación'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={isPaused ? 'resume' : 'pause'}
              onClick={() => isPaused ? resumeSimulation() : pauseSimulation()}
            >
              {isPaused ? '▶ Reanudar' : '⏸ Pausar'}
            </button>
            <button type="button" className="warning" onClick={() => stopSimulation()}>
              ■ Detener
            </button>
          </>
        )}
        {(isRunning || isPaused || isCompleted) && (
          <button
            type="button"
            className="report-btn"
            onClick={() => void computeReport()}
            disabled={isComputingReport}
            title="Detiene la animación y genera el informe final al instante"
          >
            {isComputingReport ? 'Calculando…' : '📋 Finalizar e Informar'}
          </button>
        )}
      </div>
    </aside>
  )
}

// ── Slider ───────────────────────────────────────────────────────────────────

interface RangeInputProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  hint?: string
  disabled?: boolean
  onChange: (v: number) => void
}

function RangeInput({ label, value, min, max, step = 1, hint, disabled, onChange }: RangeInputProps) {
  return (
    <label className="range-input">
      <div className="range-input-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
      />
      {hint && <small className="range-hint">{hint}</small>}
    </label>
  )
}
