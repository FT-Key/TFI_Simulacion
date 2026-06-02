import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSimulationStore } from '../../state/simulationStore'
import type { DeviceEvent } from '../../types/simulation'

import galponBg  from '../../assets/sprites/galpon.png'
import estSpr    from '../../assets/sprites/estaciones.png'
import empFrente from '../../assets/sprites/empleado_frente.png'
import empF1     from '../../assets/sprites/empleado_frame1.png'
import empF2     from '../../assets/sprites/empleado_frame2.png'
import empF3     from '../../assets/sprites/empleado_frame3.png'
import pBlanca   from '../../assets/sprites/impresora_blanca.png'
import pGigante  from '../../assets/sprites/impresora_gigante.png'
import pNegra    from '../../assets/sprites/impresora_negra.png'
import pOficina  from '../../assets/sprites/impresora_oficina.png'

import imgMetales  from '../../assets/images/metales_valiosos.png'
import imgFerroso  from '../../assets/images/componente_ferroso.png'
import imgPlastico from '../../assets/images/plastico.png'
import imgAluminio from '../../assets/images/aluminio.png'
import imgCobre    from '../../assets/images/cobre.png'
import imgResiduos from '../../assets/images/residuos.png'
import imgDolar    from '../../assets/images/dolar.png'

import './AnimationScene.css'

// ── Helpers compartidos con MetricsDashboard ─────────────────────────────

const ARS = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function simTimeStr(minutes?: number): string {
  if (minutes == null) return '--:--'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const TYPE_LABEL: Record<string, string> = {
  INKJET: 'Hogareña', LASER: 'Láser oficina', INDUSTRIAL: 'Industrial',
}
const TYPE_COLOR: Record<string, string> = {
  INKJET: '#3aa1ff', LASER: '#f2c744', INDUSTRIAL: '#e0754a',
}

// ── Sprites / pools ───────────────────────────────────────────────────────

const WALK_FRAMES = [empF1, empF2, empF3]

const PRINTER_BY_TYPE: Record<string, string> = {
  INKJET: pBlanca, LASER: pOficina, INDUSTRIAL: pGigante,
}
const PRINTER_POOL = [pBlanca, pNegra, pOficina, pGigante]

const BINS = [
  { img: imgMetales,  label: 'Metales'  },
  { img: imgFerroso,  label: 'Ferroso'  },
  { img: imgPlastico, label: 'Plástico' },
  { img: imgAluminio, label: 'Aluminio' },
  { img: imgCobre,    label: 'Cobre'    },
  { img: imgResiduos, label: 'Residuos' },
  { img: imgDolar,    label: 'Valor Comercial' },  // índice 6 — venta directa
]

// ── Helpers de layout ─────────────────────────────────────────────────────

/**
 * Área del piso donde van las estaciones (% del alto de la escena).
 * FLOOR_TOP puede estar "en la pared" del galpon — se ve correcto en
 * perspectiva 2.5D porque las estaciones más altas están más al fondo.
 * Ampliamos el rango para que 6 filas del MISMO TAMAÑO quepan.
 */
const FLOOR_TOP = 20   // más arriba para tener más espacio total
const FLOOR_BOT = 100  // hasta el borde del contenedor

const getStationY = (idx: number, total: number): number => {
  const h = FLOOR_BOT - FLOOR_TOP
  return Math.round(FLOOR_TOP + (idx + 0.5) * (h / total))
}

/**
 * Ancho FIJO de la mesa para todas las cantidades — mantiene el tamaño
 * visual que se ve bien con N=4 y que el usuario aprobó.
 */
const getStationWidth = (_total: number): number => 41

/**
 * Z-index de la estación: las más bajas (más al frente) tienen z mayor.
 * Cada estación i: z = (i+1)*10  → 10, 20, 30, …
 */
const getStationZ = (idx: number) => (idx + 1) * 10

/**
 * Z-index del empleado: justo POR DEBAJO de su estación pero POR ENCIMA
 * de todas las estaciones anteriores (más al fondo).
 * Empleado en estación i: z = (i+1)*10 - 2  → 8, 18, 28, …
 */
const getEmpZ = (stationIdx: number) => (stationIdx + 1) * 10 - 2

/**
 * Posición X del operario opIdx dentro de una estación.
 * El rango se calcula dinámicamente según el ancho de la mesa (stationWidth%),
 * que arranca en left:22% con un margen interior de 2% a cada lado.
 */
const STATION_LEFT_PCT = 32

/**
 * Posición X de la impresora sobre la mesa para el operario opIdx.
 * Se distribuyen centradas en la mesa con separación fija, independientemente
 * de homeX — así nunca caen fuera del área visual de la mesa.
 */
const getPrinterX = (opIdx: number, opsPerStation: number, stationWidth: number): number => {
  const center = STATION_LEFT_PCT + stationWidth * 0.5
  if (opsPerStation <= 1) return Math.round(center)
  const spread = Math.min(stationWidth * 0.22, 7)  // separación máx ±7%
  const frac   = opIdx / (opsPerStation - 1)       // 0 → izq, 1 → der
  return Math.round(center + (frac - 0.5) * 2 * spread)
}

/** X fija de la columna de operarios de triaje (entre cola llegada y mesas). */
const TRIAGE_EMP_X = 13
const getEmpHomeX = (opIdx: number, opsPerStation: number, stationWidth: number): number => {
  const left  = STATION_LEFT_PCT + 2
  const right = STATION_LEFT_PCT + stationWidth - 2
  if (opsPerStation === 1) return Math.round((left + right) / 2)
  return Math.round(left + (opIdx / (opsPerStation - 1)) * (right - left))
}

/** X del centro del bin i en la columna derecha */
const getBinY = (i: number) => Math.round(2 + (i + 1) * (96 / 7))
const BIN_COL_X = 92

const EMP_X_QUEUE = 8   // X cuando busca en la Cola B

// ── Types ─────────────────────────────────────────────────────────────────

interface FlyingPrinter {
  id:   string
  img:  string
  dest: 'caso_a' | 'terminal' | 'caso_b'
}

type EmpPhase = 'idle' | 'to_queue' | 'carrying' | 'working' | 'to_bin' | 'returning'

interface DesguaceEmp {
  id:           string
  slot:         number
  stationIdx:   number   // fila de estación (0-based)
  homeX:        number   // X de reposo del operario
  phase:        EmpPhase
  printerImg:   string
  activeBinIdx: number
  materials:    boolean[]
  label:        string
}

// ── FlyingPrinter ─────────────────────────────────────────────────────────

function FlyingPrinterSprite({ item }: { item: FlyingPrinter }) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <img
      src={item.img}
      alt=""
      className={`fly-printer ${active ? `fly-${item.dest}` : ''}`}
    />
  )
}

// ── DesguaceEmployee ──────────────────────────────────────────────────────

function DesguaceEmployee({
  emp,
  walkFrame,
  totalStations,
}: {
  emp:           DesguaceEmp
  walkFrame:     number
  totalStations: number
}) {
  const stationY = getStationY(emp.stationIdx, totalStations)
  const empZ     = getEmpZ(emp.stationIdx)

  const empX =
    emp.phase === 'to_queue'  ? EMP_X_QUEUE
    : emp.phase === 'to_bin'  ? BIN_COL_X - 4
    : emp.homeX

  const empY =
    emp.phase === 'to_bin' ? getBinY(emp.activeBinIdx) : stationY

  const goingLeft = emp.phase === 'to_queue'
  const isWorking = emp.phase === 'working'
  const sprite    = isWorking ? empFrente : WALK_FRAMES[walkFrame]

  return (
    <div
      className="scene-emp"
      style={
        {
          '--ex':   `${empX}%`,
          '--ey':   `${empY}%`,
          '--empz': empZ,
        } as CSSProperties
      }
    >
      <div className="emp-body">
        <img
          src={sprite}
          alt="Operario"
          className="emp-spr"
          style={{ transform: goingLeft ? 'scaleX(-1)' : 'none' }}
        />
        {/* En 'working' la impresora está en la mesa; solo se muestra aquí cuando la lleva */}
        {emp.phase === 'carrying' && (
          <img src={emp.printerImg} alt="" className="emp-carried" />
        )}
      </div>
      {emp.label && <span className="emp-tag">{emp.label}</span>}
    </div>
  )
}

// ── EconCell — celda del strip económico ─────────────────────────────────────

function EconCell({
  label, value, color, bold,
}: { label: string; value: number; color: 'pos' | 'neg'; bold?: boolean }) {
  return (
    <div className="econ-cell">
      <span className="econ-lbl">{label}</span>
      <span className={`econ-val econ-${color}${bold ? ' econ-val--bold' : ''}`}>
        {ARS(Math.abs(value))}
      </span>
    </div>
  )
}

const DAY_NAMES   = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MONTH_NAMES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                     'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ── AnimEventTicker — evento actual en la barra inferior ─────────────────

function AnimEventTicker({ event }: { event: DeviceEvent }) {
  if (event.eventType === 'ARRIVALS') {
    if (event.workDay === false) {
      return (
        <div className="anim-ticker-row">
          <span className="atk-icon">{event.holidayName ? '🏛' : '🔒'}</span>
          <span className="atk-day">Día {event.dayNumber}</span>
          <span className="atk-label">
            {event.holidayName ? event.holidayName : 'Fin de semana — planta cerrada'}
          </span>
        </div>
      )
    }
    if (event.suspended) {
      return (
        <div className="anim-ticker-row">
          <span className="atk-icon">🚫</span>
          <span className="atk-day">Día {event.dayNumber}</span>
          <span className="atk-label">Sin recepción — planta bajo clausura</span>
        </div>
      )
    }
    return (
      <div className="anim-ticker-row">
        <span className="atk-icon">📦</span>
        <span className="atk-day">Día {event.dayNumber}</span>
        <span className="atk-time">08:00</span>
        <span className="atk-label">
          <strong>{event.arrivalsCount}</strong> dispositivos ingresaron hoy
        </span>
      </div>
    )
  }

  if (event.eventType === 'DAY_END') {
    if (event.workDay === false) return null
    return (
      <div className="anim-ticker-row">
        <span className="atk-icon">🏁</span>
        <span className="atk-day">Día {event.dayNumber}</span>
        <span className="atk-time">17:00</span>
        <span className="atk-label">Jornada finalizada</span>
      </div>
    )
  }

  if (event.eventType === 'TRIAGE') {
    const result = event.triageResult!
    const cfg = {
      CASO_A:   { label: 'CASO A',   color: '#3aa1ff' },
      TERMINAL: { label: 'TERMINAL', color: '#e05050' },
      CASO_B:   { label: 'COLA ↓',   color: '#f2c744' },
    }[result] ?? { label: result, color: '#aac4ff' }
    return (
      <div className="anim-ticker-row" style={{ borderLeftColor: cfg.color }}>
        {result === 'CASO_B'
          ? <span className="atk-seq">#{event.caseBNum}</span>
          : <span className="atk-seq atk-seq--empty" />}
        <span className="atk-time">{simTimeStr(event.simTimeMinutes)}</span>
        <span className="atk-phase">TRIAJE</span>
        <span className="atk-type" style={{ color: TYPE_COLOR[event.deviceType ?? ''] ?? '#89a8de' }}>
          {TYPE_LABEL[event.deviceType ?? ''] ?? '—'}
        </span>
        <span className="atk-weight">{event.weightKg?.toFixed(1)} kg</span>
        <span className="atk-result" style={{ color: cfg.color }}>{cfg.label}</span>
        {result === 'CASO_A' && event.caseARevenue != null && (
          <span className="atk-revenue">{ARS(event.caseARevenue)}</span>
        )}
      </div>
    )
  }

  if (event.eventType === 'DESGUACE') {
    const mats = [
      event.preciousKg  && event.preciousKg  > 0 ? 'Metales' : null,
      event.ferrousKg   && event.ferrousKg   > 0 ? 'Ferroso' : null,
      event.plasticKg   && event.plasticKg   > 0 ? 'Plástico': null,
      event.aluminumKg  && event.aluminumKg  > 0 ? 'Aluminio': null,
      event.copperKg    && event.copperKg    > 0 ? 'Cobre'   : null,
    ].filter(Boolean).join(', ')
    const rev = (event.materialRevenue ?? 0)
    return (
      <div className="anim-ticker-row" style={{ borderLeftColor: '#2ad46f' }}>
        <span className="atk-seq">#{event.caseBNum}</span>
        <span className="atk-time">{simTimeStr(event.simTimeMinutes)}</span>
        <span className="atk-phase">DESGUACE</span>
        <span className="atk-type" style={{ color: TYPE_COLOR[event.deviceType ?? ''] ?? '#89a8de' }}>
          {TYPE_LABEL[event.deviceType ?? ''] ?? '—'}
        </span>
        <span className="atk-weight">{event.weightKg?.toFixed(1)} kg</span>
        {mats && <span className="atk-mats">{mats}</span>}
        {rev > 0 && <span className="atk-revenue">{ARS(rev)}</span>}
      </div>
    )
  }

  if (event.eventType === 'TRIAGE_SUMMARY') {
    return (
      <div className="anim-ticker-row">
        <span className="atk-icon">📋</span>
        <span className="atk-day">Día {event.dayNumber}</span>
        <span className="atk-label">
          Resumen triaje — clasificados: <strong>{event.triageClassified}</strong>
          {(event.triageLeftover ?? 0) > 0 && (
            <> · ⚠ <strong>{event.triageLeftover}</strong> pasan al día siguiente</>
          )}
        </span>
      </div>
    )
  }

  if (event.eventType === 'SUSPENSION_END') {
    return (
      <div className="anim-ticker-row">
        <span className="atk-icon">🚨</span>
        <span className="atk-day">Día {event.dayNumber}</span>
        <span className="atk-label">Clausura finalizada</span>
        <span className="atk-revenue" style={{ color: '#e05050' }}>
          −{ARS(event.suspensionPenalty ?? 0)}
        </span>
      </div>
    )
  }

  return null
}

// ── AnimationScene ────────────────────────────────────────────────────────

export function AnimationScene() {
  const visibleEvents = useSimulationStore((s) => s.visibleEvents)
  const isRunning     = useSimulationStore((s) => s.isRunning)
  const config        = useSimulationStore((s) => s.config)
  const snapshot      = useSimulationStore((s) => s.snapshot)
  const isPaused      = useSimulationStore((s) => s.isPaused)
  const resetKey      = useSimulationStore((s) => s.resetKey)

  const [arrivalCount,   setArrivalCount]   = useState(0)
  const [colaBCount,     setColaBCount]     = useState(0)
  const [flyingPrinters, setFlyingPrinters] = useState<FlyingPrinter[]>([])
  const [desguaceEmps,   setDesguaceEmps]   = useState<DesguaceEmp[]>([])
  const [activeBins,     setActiveBins]     = useState<Set<number>>(new Set())
  const [walkFrame,      setWalkFrame]      = useState(0)
  const [triageActive,   setTriageActive]   = useState<Set<number>>(new Set())
  const [clockMin,       setClockMin]       = useState(480)   // 08:00

  interface PlantOverlay {
    type: 'open' | 'closed'
    dayNumber: number
    dayOfMonth: number
    month: number
    reason?: string   // fin de semana / nombre feriado (solo 'closed')
  }
  const [plantOverlay, setPlantOverlay] = useState<PlantOverlay | null>(null)

  interface DayEndOverlay { dayNumber: number; netProfit: number }
  const [dayEndOverlay, setDayEndOverlay] = useState<DayEndOverlay | null>(null)

  // Ref al snapshot actual para capturar valores en el momento exacto del DAY_END
  const snapshotRef = useRef(snapshot)
  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])

  // ── Reloj event-driven con interpolación suave ───────────────────────────
  // El problema con la tasa fija (540/tickMs): los eventos avanzan a 7.5sim-min
  // por reveal-interval, que es 25% más rápido que el reloj → reloj siempre detrás.
  // Solución: el reloj persigue el simTime del último evento revelado con suavizado
  // exponencial: cubre ~95% de la distancia en 1 reveal-interval (~18 ticks de 100ms).
  const clockSimMinRef   = useRef(480)       // valor actual del display
  const clockTargetRef   = useRef(480)       // sim-time objetivo (último evento)
  const clockLastTickRef = useRef<number | null>(null) // null = día no iniciado
  const isPausedRef      = useRef(isPaused)
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])

  useEffect(() => {
    const t = setInterval(() => setWalkFrame((f) => (f + 1) % 3), 150)
    return () => clearInterval(t)
  }, [])

  // Tick del reloj: interpolación suave hacia clockTargetRef.
  useEffect(() => {
    const t = setInterval(() => {
      if (clockLastTickRef.current === null) return
      if (isPausedRef.current) return
      const target  = Math.min(clockTargetRef.current, 17 * 60)
      const current = clockSimMinRef.current
      if (target <= current) return
      const diff = target - current
      // Avance: 15% del gap restante cada 100 ms → cubre ~95% en ~1.8 s (1 reveal)
      const step = Math.max(diff * 0.15, 0.05)
      clockSimMinRef.current = Math.min(current + step, 17 * 60)
      setClockMin(Math.round(clockSimMinRef.current))
    }, 100)
    return () => clearInterval(t)
  }, [])

  // Actualizar el target cuando llegan nuevos eventos revelados
  useEffect(() => {
    const lastTimed = [...visibleEvents].reverse().find((e) => e.simTimeMinutes != null)
    if (lastTimed?.simTimeMinutes != null) {
      clockTargetRef.current = Math.max(clockTargetRef.current, lastTimed.simTimeMinutes)
    }
  }, [visibleEvents])

  // Cola de dispositivos CASO_B pendientes: {num=caseBNum, type, slot=workerSlot}.
  // slot indica el slot de animación real del operario asignado, propagado desde el DESGUACE.
  // Removemos por caseBNum (no por posición) porque con procesamiento paralelo los DESGUACE
  // completan fuera de orden de inserción → slice(1) quitaría el tipo incorrecto.
  const [casoBTypes, setCasoBTypes] = useState<{ num: number; type: string; slot: number }[]>([])

  // Ref con tickMs actual (para escalar la animación a la velocidad de la simulación)
  const tickMsRef = useRef(config.tickMs)
  useEffect(() => { tickMsRef.current = config.tickMs }, [config.tickMs])

  // Slots: hasta 6 estaciones × 4 operarios = 24 máx
  const slotsRef       = useRef<boolean[]>(Array(24).fill(false))
  const processedRef   = useRef(new Set<string>())
  const prevRunRef     = useRef(false)
  const triageRoundRef = useRef(0)
  const triageOpsRef   = useRef(Math.min(config.triageOperators, 4))

  useEffect(() => { triageOpsRef.current = Math.min(config.triageOperators, 4) }, [config.triageOperators])

  // Cola de animaciones pendientes por slot: cuando el DESGUACE de D llega antes de que
  // termine la animación del slot anterior, se guarda la función y se dispara en releaseSlot.
  const pendingBySlotRef = useRef<Map<number, () => void>>(new Map())

  const claimSlot = useCallback((targetSlot?: number) => {
    const ops      = Math.min(config.operatorsPerStation, 4)
    const stations = Math.min(config.activeStations, 6)
    const total    = stations * ops
    const stationW = getStationWidth(stations)
    if (targetSlot != null && targetSlot < total) {
      // Slot asignado por assignDesguaceTimes: si está ocupado NO caer a otro slot,
      // eso causaría el swap visual. El caller se encarga de encolar la animación.
      if (slotsRef.current[targetSlot]) {
        return { slot: -1, stationIdx: 0, homeX: 0, available: false as const }
      }
      slotsRef.current[targetSlot] = true
      const stationIdx = Math.floor(targetSlot / ops)
      const opIdx      = targetSlot % ops
      const homeX      = getEmpHomeX(opIdx, ops, stationW)
      return { slot: targetSlot, stationIdx, homeX, available: true as const }
    }
    // Sin targetSlot: primer slot libre (comportamiento original).
    const i = slotsRef.current.findIndex((s, idx) => !s && idx < total)
    if (i < 0) return { slot: -1, stationIdx: 0, homeX: 0, available: false as const }
    slotsRef.current[i] = true
    const stationIdx = Math.floor(i / ops)
    const opIdx      = i % ops
    const homeX      = getEmpHomeX(opIdx, ops, stationW)
    return { slot: i, stationIdx, homeX, available: true as const }
  }, [config.activeStations, config.operatorsPerStation])

  const releaseSlot = useCallback((s: number) => {
    slotsRef.current[s] = false
    // Si había una animación esperando este slot, dispararla ahora.
    const pending = pendingBySlotRef.current.get(s)
    if (pending) {
      pendingBySlotRef.current.delete(s)
      pending()
    }
  }, [])

  const clearVisualState = useCallback(() => {
    processedRef.current.clear()
    slotsRef.current = Array(24).fill(false)
    pendingBySlotRef.current.clear()
    triageRoundRef.current = 0
    clockLastTickRef.current = null
    clockSimMinRef.current   = 480
    clockTargetRef.current   = 480
    setArrivalCount(0); setColaBCount(0); setCasoBTypes([])
    setFlyingPrinters([]); setDesguaceEmps([]); setActiveBins(new Set())
    setTriageActive(new Set())
    setClockMin(480)
    setPlantOverlay(null)
    setDayEndOverlay(null)
  }, [])

  // Reset visual al reiniciar la simulación
  useEffect(() => {
    if (resetKey > 0) clearVisualState()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    if (isRunning && !prevRunRef.current) {
      // Nueva corrida (start): limpiar estado visual
      clearVisualState()
    }
    if (!isRunning) {
      // Simulación detenida/parada: detener el reloj
      clockLastTickRef.current = null
    }
    prevRunRef.current = isRunning
  }, [isRunning, clearVisualState])

  const processEvent = useCallback(
    (event: DeviceEvent) => {
      // La key debe ser única por jornada en TODOS los tipos de evento.
      // ARRIVALS/DAY_END tienen seq=-1/-2 compartidos entre días → siempre usan dayNumber.
      // TRIAGE/DESGUACE: el backend puede reiniciar seq en cada día (seq 1,2,3… por jornada),
      // por lo que incluimos dayNumber para evitar colisiones entre días distintos.
      const key = `${event.eventType}|day${event.dayNumber ?? 0}|seq${event.seq}`
      if (processedRef.current.has(key)) return
      processedRef.current.add(key)

      // Ilumina brevemente el bin i (compartido por TRIAGE Caso A y DESGUACE)
      const glowBin = (i: number) => {
        setActiveBins((s) => new Set([...s, i]))
        setTimeout(() => setActiveBins((s) => { const n = new Set(s); n.delete(i); return n }), 850)
      }

      if (event.eventType === 'ARRIVALS') {
        setArrivalCount(event.workDay && !event.suspended ? (event.arrivalsCount ?? 0) : 0)

        const dayNum    = event.dayNumber   ?? 0
        const dayOfMon  = event.dayOfMonth  ?? 1
        const month     = event.currentMonth ?? 1

        if (!event.workDay) {
          // Día no laborable: overlay "Planta Cerrada" con motivo
          const reason = event.holidayName ?? 'Fin de semana'
          setPlantOverlay({ type: 'closed', dayNumber: dayNum, dayOfMonth: dayOfMon, month, reason })
        } else {
          // Día laborable: overlay "Planta Abierta" breve
          setPlantOverlay({ type: 'open', dayNumber: dayNum, dayOfMonth: dayOfMon, month })
          setTimeout(() => setPlantOverlay(null), 1_000)
          // Arrancar el reloj
          clockSimMinRef.current   = 480
          clockTargetRef.current   = 480
          clockLastTickRef.current = Date.now()
          setClockMin(480)

          // Asignar workerSlots a los ítems arrastrados (carry-overs con slot=-1).
          // caseBSlotMap viene del simulationStore e incluye todos los procesados
          // hoy, con su workerSlot real (el mismo que usará el evento DESGUACE).
          if (event.caseBSlotMap) {
            const slotMap = event.caseBSlotMap
            setCasoBTypes((prev) => prev.map((item) =>
              item.slot < 0 && slotMap[item.num] != null
                ? { ...item, slot: slotMap[item.num] }
                : item
            ))
          }
        }
        return
      }

      if (event.eventType === 'DAY_END' && event.workDay !== false) {
        const { dailyNetProfit } = snapshotRef.current
        const dayNum = event.dayNumber ?? 0
        setDayEndOverlay({ dayNumber: dayNum, netProfit: dailyNetProfit })
        setTimeout(() => setDayEndOverlay(null), 4_000)
        return
      }

      if (event.eventType === 'TRIAGE') {
        const img  = PRINTER_BY_TYPE[event.deviceType ?? 'INKJET'] ?? pOficina
        const dest: FlyingPrinter['dest'] =
          event.triageResult === 'CASO_A'    ? 'caso_a'
          : event.triageResult === 'TERMINAL' ? 'terminal'
          : 'caso_b'
        setArrivalCount((p) => Math.max(0, p - 1))

        // Animar operario de triaje (round-robin entre los disponibles)
        const wIdx = triageRoundRef.current % triageOpsRef.current
        triageRoundRef.current++
        setTriageActive((prev) => new Set([...prev, wIdx]))
        setTimeout(() => setTriageActive((prev) => {
          const n = new Set(prev); n.delete(wIdx); return n
        }), 1_400)

        const flyId = `fly-${event.seq}`
        setFlyingPrinters((p) => [...p, { id: flyId, img, dest }])
        if (dest === 'caso_b') {
          // slot=-1 indica "ítem en cola sin slot asignado aún" (ocurre cuando el
          // día termina con ítems sin procesar y el DESGUACE queda para el día siguiente).
          setCasoBTypes((prev) => [...prev, { num: event.caseBNum ?? 0, type: event.deviceType ?? 'INKJET', slot: event.workerSlot ?? -1 }])
          setTimeout(() => setColaBCount((p) => p + 1), 1_200)
        }
        if (dest === 'caso_a') setTimeout(() => glowBin(6), 1_200)
        setTimeout(() => setFlyingPrinters((p) => p.filter((f) => f.id !== flyId)), 1_700)
        return
      }

      if (event.eventType === 'DESGUACE') {
        const img = PRINTER_BY_TYPE[event.deviceType ?? 'INKJET'] ?? pOficina
        const materials: boolean[] = [
          (event.preciousKg ?? 0) > 0,
          (event.ferrousKg  ?? 0) > 0,
          (event.plasticKg  ?? 0) > 0,
          (event.aluminumKg ?? 0) > 0,
          (event.copperKg   ?? 0) > 0,
          false,
        ]
        const filled = materials.filter(Boolean).length

        // Remover por caseBNum global: ID único por dispositivo, nunca se repite
        // entre días. Elimina el ítem exacto sin importar posición ni día de origen.
        setCasoBTypes((prev) => {
          if (event.caseBNum != null) {
            const idx = prev.findIndex((item) => item.num === event.caseBNum)
            if (idx >= 0) return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
          }
          return prev.length > 0 ? prev.slice(1) : prev
        })
        setColaBCount((p) => Math.max(0, p - 1))

        // Escalar tiempos de animación según la velocidad de simulación
        // A ×10 (162 000 ms/día) se usa 40% del tiempo base para que los
        // slots se liberen antes de que llegue el próximo DESGUACE de esa estación.
        const fast   = tickMsRef.current <= 162_000
        const BIN_START = fast ? 700  : 1_800
        const PER_BIN   = fast ? 320  :   800
        const TAIL_MS   = fast ? 160  :   400
        const RETURN_MS = fast ? 360  :   900

        // doAnimate: ejecuta la secuencia de animación para un slot+posición dados.
        // Se llama inmediatamente si el slot está libre, o diferida desde releaseSlot.
        const empId = `emp-${event.seq}`
        const doAnimate = (slot: number, stationIdx: number, homeX: number) => {
          const upd = (u: Partial<DesguaceEmp>) =>
            setDesguaceEmps((p) => p.map((e) => (e.id === empId ? { ...e, ...u } : e)))

          setDesguaceEmps((p) => [...p, {
            id: empId, slot, stationIdx, homeX, phase: 'working', printerImg: img,
            activeBinIdx: -1, materials, label: 'Desarmando…',
          }])

          let order = 0
          materials.forEach((has, i) => {
            if (!has) return
            const delay = BIN_START + order++ * PER_BIN
            setTimeout(() => {
              upd({ phase: 'to_bin', activeBinIdx: i, label: `Depositando ${BINS[i].label}…` })
              glowBin(i)
            }, delay)
          })

          const total = BIN_START + filled * PER_BIN + TAIL_MS
          setTimeout(() => upd({ phase: 'returning', label: '' }), total)
          setTimeout(() => {
            releaseSlot(slot)
            setDesguaceEmps((p) => p.filter((e) => e.id !== empId))
          }, total + RETURN_MS)
        }

        const claimed = claimSlot(event.workerSlot)
        if (!claimed.available) {
          const ws = event.workerSlot
          if (ws != null) {
            // El slot correcto está ocupado por la animación anterior — encolar para cuando se libere.
            const ops  = Math.min(config.operatorsPerStation, 4)
            const stW  = getStationWidth(Math.min(config.activeStations, 6))
            const sIdx = Math.floor(ws / ops)
            const oIdx = ws % ops
            const hX   = getEmpHomeX(oIdx, ops, stW)
            pendingBySlotRef.current.set(ws, () => {
              slotsRef.current[ws] = true   // reclamar el slot ahora que está libre
              doAnimate(ws, sIdx, hX)
            })
          } else {
            materials.forEach((has, i) => {
              if (has) setTimeout(() => glowBin(i), 200 + i * 120)
            })
          }
          return
        }
        doAnimate(claimed.slot, claimed.stationIdx, claimed.homeX)
      }
    },
    [claimSlot, releaseSlot],
  )

  useEffect(() => {
    visibleEvents.forEach((e) => processEvent(e))
  }, [visibleEvents, processEvent])

  // Derived counts
  const stations       = Math.min(config.activeStations, 6)
  const opsPerStation  = Math.min(config.operatorsPerStation, 4)
  const triageOpsCount = Math.min(config.triageOperators, 4)
  const stationWidth   = getStationWidth(stations)
  const visArrival     = Math.min(12, arrivalCount)
  const ovfArrival     = Math.max(0, arrivalCount - visArrival)

  // Cola "Para Desguace": colaBCount = en cola (DESGUACE aún no disparó).
  // Estimamos cuántos están en proceso según capacidad concurrente configurada.
  const maxConcurrent  = stations * opsPerStation
  const colaBInProcess = Math.min(colaBCount, maxConcurrent)
  const colaBWaiting   = Math.max(0, colaBCount - colaBInProcess)
  const visColaB       = Math.min(8, colaBWaiting)
  const ovfColaB       = Math.max(0, colaBWaiting - visColaB)

  // Phantoms: impresoras en mesas para dispositivos que la sim está procesando
  // pero cuyo evento DESGUACE todavía no disparó (no tienen emp animado todavía).
  //
  // colaBInProcess mide dispositivos PRE-DESGUACE (antes de que dispare el evento).
  // desguaceEmps mide dispositivos POST-DESGUACE (el evento ya disparó, el emp anima).
  // Son conjuntos disjuntos → phantomCount = colaBInProcess directamente.
  //
  // occupiedSlots incluye TODOS los emps (cualquier fase), no solo 'working', para
  // que un slot con un emp en 'to_bin' o 'returning' no reciba un phantom espurio.
  const occupiedSlots = new Set(desguaceEmps.map((e) => e.slot))
  const maxSlots      = stations * opsPerStation

  // Phantoms: ítems PRE-DESGUACE visibles en las mesas.
  // Muestra cualquier ítem con slot válido (asignado en TRIAGE o ARRIVALS) que no
  // tenga empleado animado encima. No usamos slice(colaBInProcess) porque los ítems
  // arrastrados sin slot (-1) pueden ocupar las primeras posiciones del array y
  // bloquear la vista de ítems con slot válido que están más atrás.
  const phantomItems = casoBTypes
    .filter((item) => item.slot >= 0 && item.slot < maxSlots && !occupiedSlots.has(item.slot))
    .filter((item, idx, arr) => arr.findIndex((x) => x.slot === item.slot) === idx)

  const waitingTypes = casoBTypes.slice(colaBInProcess).map((e) => e.type)

  return (
    <div className="sprite-scene">

      {/* Fondo */}
      <img src={galponBg} alt="" className="scene-bg" draggable={false} />

      {/* Reloj digital simulado — zona de la puerta, arriba izquierda */}
      <div className="sim-clock">
        <span className="sim-clock-display">{simTimeStr(clockMin)}</span>
        {snapshot.currentDay > 0 && !snapshot.workDay && (
          <span className="sim-clock-closed">CERRADO</span>
        )}
      </div>

      {/* Strip económico — centro superior, entre reloj y bins */}
      <div className={`econ-strip${snapshot.currentDay === 0 ? ' econ-strip--idle' : ''}`}>
        <EconCell label="Caso A" value={snapshot.dailyCaseARevenue}    color="pos" />
        <div className="econ-sep" />
        <EconCell label="Material" value={snapshot.dailyMaterialRevenue} color="pos" />
        <div className="econ-sep" />
        <EconCell label="Personal" value={-snapshot.dailyLaborCost}      color="neg" />
        <div className="econ-sep" />
        <EconCell label="Neto hoy" value={snapshot.dailyNetProfit}       color={snapshot.dailyNetProfit >= 0 ? 'pos' : 'neg'} bold />
        <div className="econ-sep econ-sep--thick" />
        <EconCell label="Acum. neto" value={snapshot.totalNetProfit}     color={snapshot.totalNetProfit >= 0 ? 'pos' : 'neg'} bold />
      </div>

      {/* Operarios de triaje — columna fija a la izquierda de las mesas */}
      {Array.from({ length: triageOpsCount }, (_, i) => {
        const isWorking = triageActive.has(i)
        const ty = getStationY(i, triageOpsCount)
        return (
          <div
            key={`triage-emp-${i}`}
            className={`scene-emp${isWorking ? ' triage-working' : ' emp-idle'}`}
            style={
              {
                '--ex':   `${TRIAGE_EMP_X}%`,
                '--ey':   `${ty}%`,
                '--empz': 50,
              } as CSSProperties
            }
          >
            <div className="emp-body">
              <img
                src={isWorking ? WALK_FRAMES[walkFrame] : empFrente}
                alt="Triajista"
                className="emp-spr"
              />
            </div>
            {isWorking && <span className="emp-tag">Triando…</span>}
          </div>
        )
      })}

      {/*
        Render intercalado por fila: para cada estación i, primero el/los
        empleado/s (z bajo) y después la mesa (z alto), para que la mesa
        tape la parte baja del empleado. Estaciones más bajas tienen z mayor
        → tapan a los empleados de filas superiores.
      */}
      {Array.from({ length: stations }, (_, si) => {
        const sy  = getStationY(si, stations)
        const stz = getStationZ(si)
        const empZ = getEmpZ(si)

        return (
          <div key={`row-${si}`} className="station-row-group">
            {/* Empleados de esta fila */}
            {Array.from({ length: opsPerStation }, (__, oi) => {
              const globalSlot = si * opsPerStation + oi
              const isBusy     = desguaceEmps.some((e) => e.slot === globalSlot)
              if (isBusy) return null
              return (
                <div
                  key={`idle-${globalSlot}`}
                  className="scene-emp emp-idle"
                  style={
                    {
                      '--ex':   `${getEmpHomeX(oi, opsPerStation, stationWidth)}%`,
                      '--ey':   `${sy}%`,
                      '--empz': empZ,
                    } as CSSProperties
                  }
                >
                  <img src={empFrente} alt="Operario" className="emp-spr" draggable={false} />
                </div>
              )
            })}

            {/* Mesa de esta fila — encima de los empleados de la misma fila */}
            <img
              src={estSpr}
              alt={`Estación ${si + 1}`}
              className="scene-station"
              style={
                {
                  '--sy':  `${sy}%`,
                  '--stz': stz,
                  '--stw': `${stationWidth}%`,
                } as CSSProperties
              }
              draggable={false}
            />
          </div>
        )
      })}

      {/* Empleados animados (desguace) — se renderizan por separado */}
      {desguaceEmps.map((emp) => (
        <DesguaceEmployee
          key={emp.id}
          emp={emp}
          walkFrame={walkFrame}
          totalStations={stations}
        />
      ))}

      {/* Impresoras sobre la mesa — visibles mientras el operario desarma */}
      {desguaceEmps
        .filter((emp) => emp.phase === 'working')
        .map((emp) => {
          const sy     = getStationY(emp.stationIdx, stations)
          const stz    = getStationZ(emp.stationIdx)
          const opIdx  = emp.slot % opsPerStation
          const px     = getPrinterX(opIdx, opsPerStation, stationWidth)
          return (
            <img
              key={`tp-${emp.id}`}
              src={emp.printerImg}
              alt=""
              className="table-printer"
              draggable={false}
              style={
                {
                  '--tpx': `${px}%`,
                  '--tpy': `${sy}%`,
                  '--tpz': stz + 1,
                } as CSSProperties
              }
            />
          )
        })
      }

      {/* Impresoras fantasma en mesas — dispositivos en proceso antes de su DESGUACE.
          Cada phantom usa el slot real (workerSlot) del dispositivo, no el primer slot libre,
          para que la impresora aparezca en la mesa correcta desde el triaje hasta el desguace. */}
      {phantomItems.map((item) => {
        const si         = Math.floor(item.slot / opsPerStation)
        const oi         = item.slot % opsPerStation
        const sy         = getStationY(si, stations)
        const stz        = getStationZ(si)
        const px         = getPrinterX(oi, opsPerStation, stationWidth)
        const printerSrc = PRINTER_BY_TYPE[item.type] ?? pOficina
        return (
          <img
            key={`phantom-${item.slot}`}
            src={printerSrc}
            alt=""
            className="table-printer table-printer--phantom"
            draggable={false}
            style={
              {
                '--tpx': `${px}%`,
                '--tpy': `${sy}%`,
                '--tpz': stz + 1,
              } as CSSProperties
            }
          />
        )
      })}

      {/* Cola de llegada — columna de dispositivos junto al triajista */}
      <div className="arrival-queue">
        {arrivalCount > 0 && (
          <div className="q-header">
            <span className="q-total">{arrivalCount}</span>
            <span className="q-header-lbl">por triar</span>
          </div>
        )}
        <div className="q-printers-col">
          {Array.from({ length: visArrival }, (_, i) => (
            <img
              key={`${arrivalCount}-${i}`}
              src={PRINTER_POOL[i % 4]}
              alt=""
              className="q-printer"
              draggable={false}
            />
          ))}
          {ovfArrival > 0 && <span className="q-badge">+{ovfArrival} más</span>}
        </div>
      </div>

      {/* Para Desguace */}
      {colaBCount > 0 && (
        <div className="colab-box">
          <span className="colab-title">Para Desguace</span>
          {/* Impresoras en espera (las que aún no fueron asignadas a una mesa) */}
          {colaBWaiting > 0 && (
            <div className="colab-printers">
              {Array.from({ length: visColaB }, (_, i) => (
                <img
                  key={i}
                  src={PRINTER_BY_TYPE[waitingTypes[i] ?? ''] ?? PRINTER_POOL[i % 4]}
                  alt=""
                  className="colab-printer"
                  draggable={false}
                />
              ))}
              {ovfColaB > 0 && <span className="q-badge">+{ovfColaB}</span>}
            </div>
          )}
          <div className="colab-stats">
            {colaBWaiting > 0 && (
              <span className="colab-stat colab-stat--wait">
                {colaBWaiting} en espera
              </span>
            )}
            {colaBInProcess > 0 && (
              <span className="colab-stat colab-stat--proc">
                ⚙ {colaBInProcess} desarmando
              </span>
            )}
          </div>
        </div>
      )}

      {/* Printers volando */}
      {flyingPrinters.map((fp) => (
        <FlyingPrinterSprite key={fp.id} item={fp} />
      ))}

      {/* Columna de bins (derecha, sin fondo) */}
      <div className="bins-col">
        {BINS.map((bin, i) => (
          <div
            key={bin.label}
            className={`bin-slot ${activeBins.has(i) ? 'bin-active' : ''}`}
            style={{ position: 'relative', zIndex: i + 1 }}
          >
            <img src={bin.img} alt={bin.label} className="bin-img" draggable={false} />
            {i === 6 && <span className="bin-lbl">{bin.label}</span>}
          </div>
        ))}
      </div>

      {/* Barra de día — encima del ticker */}
      <div className="anim-day-bar">
        {snapshot.currentDay > 0 ? (
          <>
            <span className="adb-day">
              Día <strong>{snapshot.currentDay}</strong> / {365 * config.simulationDurationYears}
            </span>
            <span className="adb-sep">·</span>
            <span className="adb-weekday">{DAY_NAMES[snapshot.dayOfWeek] ?? '—'}</span>
            <span className="adb-date">
              {snapshot.dayOfMonth} de {MONTH_NAMES[snapshot.currentMonth] ?? '—'}
            </span>
            {snapshot.peakMonth && <span className="adb-peak">★ Mes pico</span>}
            {snapshot.suspended && (
              <span className="adb-susp">⚠ Clausura — {snapshot.suspensionDaysRemaining}d restantes</span>
            )}
            {snapshot.holidayName && (
              <span className="adb-holiday">🏛 {snapshot.holidayName}</span>
            )}
          </>
        ) : (
          <span className="adb-idle">Simulación no iniciada</span>
        )}
      </div>

      {/* Ticker — último evento revelado, barra inferior (siempre visible) */}
      <div className="anim-ticker">
        {(() => {
          // Busca el último evento que tenga render visible (no DAY_END de día no laborable)
          const last = visibleEvents.length > 0
            ? [...visibleEvents].reverse().find((e) => {
                if (e.eventType === 'DAY_END' && e.workDay === false) return false
                return true
              })
            : null
          return last
            ? <AnimEventTicker event={last} />
            : <span className="atk-idle">Esperando inicio de simulación…</span>
        })()}
      </div>

      {/* Overlay FIN DE JORNADA — aparece al terminar cada día laborable */}
      {dayEndOverlay && (
        <div className="plant-overlay plant-overlay--dayend">
          <div className="plant-overlay-card">
            <div className="plant-overlay-status">FIN DE JORNADA</div>
            <div className="plant-overlay-day">Día {dayEndOverlay.dayNumber}</div>
            <div className={`dayend-net ${dayEndOverlay.netProfit >= 0 ? 'dayend-net--pos' : 'dayend-net--neg'}`}>
              <span className="dayend-net-label">Total neto hoy</span>
              <span className="dayend-net-value">{ARS(dayEndOverlay.netProfit)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de estado de planta — aparece en transiciones de día */}
      {plantOverlay && (
        <div className={`plant-overlay plant-overlay--${plantOverlay.type}`}>
          <div className="plant-overlay-card">
            <div className="plant-overlay-status">
              {plantOverlay.type === 'open' ? 'PLANTA ABIERTA' : 'PLANTA CERRADA'}
            </div>
            <div className="plant-overlay-day">
              Día {plantOverlay.dayNumber}
            </div>
            <div className="plant-overlay-date">
              {plantOverlay.dayOfMonth} de {MONTH_NAMES[plantOverlay.month]}
            </div>
            {plantOverlay.reason && (
              <div className="plant-overlay-reason">{plantOverlay.reason}</div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
