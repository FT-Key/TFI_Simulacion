import { create } from 'zustand'
import { createSimulationTransport } from '../services/transport'
import type {
  DeviceEvent,
  DailySeriesPoint,
  MonthlySeriesPoint,
  PlantSnapshot,
  SavedReport,
  SimulationConfig,
  SimulationReport,
  StationSnapshot,
} from '../types/simulation'
export type { SimulationConfig }

// ── Persistencia de historial ─────────────────────────────────────────────────

const HISTORY_KEY = 'ema-raee-report-history'

function loadHistory(): SavedReport[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as SavedReport[]) : []
  } catch {
    return []
  }
}

function persistHistory(history: SavedReport[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // localStorage lleno — ignorar
  }
}

const transport = createSimulationTransport()

/**
 * Mapa módulo-nivel: almacena el snapshot incoming de cada día hasta que
 * el sentinel ARRIVALS de ese día es sacado de la cola y procesado.
 * Así applyClockAndCosts se ejecuta con el queueSize correcto (ya drenado
 * el día anterior) y no "contamina" las métricas del día anterior.
 */
const pendingDaySnapshots = new Map<number, PlantSnapshot>()

// ── Estado global de cola Caso B ──────────────────────────────────────────────
// Se reinicia al iniciar/resetear la simulación. Persiste entre llamadas a
// interleaveEvents (días distintos) para mantener la correspondencia correcta
// entre caseBNum y la posición real en la cola de desguace.

/** Contador global de caseBNum — nunca se reinicia entre días. */
let globalCaseBCounter = 0

/**
 * Cola de caseBNums pendientes de desguace, en el mismo orden FIFO que la
 * disassemblyQueue del backend. El frente del array = dispositivo más antiguo.
 * interleaveEvents añade los nuevos del día al final y retira los procesados.
 */
let pendingDisassemblyNums: number[] = []

function resetCaseBState() {
  globalCaseBCounter    = 0
  pendingDisassemblyNums = []
}

// ── Config por defecto ────────────────────────────────────────────────────────

const defaultConfig: SimulationConfig = {
  triageOperators: 1,
  activeStations: 3,
  operatorsPerStation: 1,
  tickMs: 162_000,         // ×10 por defecto (~1.8 seg por dispositivo)
  simulationDurationYears: 1,
}

// ── Snapshot en blanco ────────────────────────────────────────────────────────

const buildIdleStations = (config: SimulationConfig): StationSnapshot[] =>
  Array.from({ length: config.activeStations }, (_, i) => ({
    id: i + 1,
    operatorsAssigned: config.operatorsPerStation,
    dailyCompleted: 0,
    totalCompletedDevices: 0,
    utilizationPct: 0,
  }))

const createInitialSnapshot = (config: SimulationConfig): PlantSnapshot => ({
  tick: 0,
  currentDay: 0,
  currentMonth: 1,
  dayOfMonth: 1,
  dayOfWeek: 1,
  holidayName: undefined,
  peakMonth: false,
  workDay: false,
  isCompleted: false,
  queueSize: 0,
  suspended: false,
  suspensionDaysRemaining: 0,
  totalSuspensions: 0,
  dailyArrivals: 0,
  dailyCaseA: 0,
  dailyTerminalWaste: 0,
  dailyCaseB: 0,
  dailyDisassembled: 0,
  dailyCaseARevenue: 0,
  dailyMaterialRevenue: 0,
  dailyLaborCost: 0,
  dailyOpportunityInfo: 0,
  dailyNetProfit: 0,
  totalArrived: 0,
  totalCaseA: 0,
  totalTerminalWaste: 0,
  totalDisassembled: 0,
  totalCaseARevenue: 0,
  totalMaterialRevenue: 0,
  totalLaborCost: 0,
  totalOpportunityCost: 0,
  totalLogisticCost: 0,
  totalNetProfit: 0,
  kpis: { caseAPct: 0, terminalWastePct: 0, disassemblyPct: 0, queueUtilizationPct: 0, stationUtilizationPct: 0 },
  stations: buildIdleStations(config),
  materialRecoveredKg: {},
  dailySeries: [],
  deviceEvents: [],
})

// ── Helpers de actualización de snapshot ──────────────────────────────────────

/**
 * Cuando llega un nuevo snapshot del backend, actualiza los campos de reloj,
 * progreso y costos fijos del día (que se conocen de antemano). Los contadores
 * de ingresos y cantidades arrancan en 0 y se acumulan a medida que los eventos
 * se revelan en el log.
 */
function applyClockAndCosts(current: PlantSnapshot, incoming: PlantSnapshot): PlantSnapshot {
  return {
    ...current,
    // Reloj y progreso (inmediato)
    tick:                    incoming.tick,
    currentDay:              incoming.currentDay,
    currentMonth:            incoming.currentMonth,
    dayOfMonth:              incoming.dayOfMonth,
    dayOfWeek:               incoming.dayOfWeek,
    peakMonth:               incoming.peakMonth,
    workDay:                 incoming.workDay,
    holidayName:             incoming.holidayName,
    isCompleted:             incoming.isCompleted,
    suspended:               incoming.suspended,
    suspensionDaysRemaining: incoming.suspensionDaysRemaining,
    totalSuspensions:        incoming.totalSuspensions,
    // dailySeries: se aplica inmediatamente desde el snapshot del backend.
    // El backend solo agrega el punto del día al final de processTick, por lo que
    // incoming.dailySeries siempre contiene días completados (no el día en curso).
    dailySeries:             incoming.dailySeries,
    stations:                incoming.stations,
    kpis:                    incoming.kpis,
    // Costos laborales: fijos para el día, se aplican de inmediato
    dailyLaborCost:          incoming.dailyLaborCost,
    dailyOpportunityInfo:    incoming.dailyOpportunityInfo,
    totalLaborCost:          incoming.totalLaborCost,
    totalOpportunityCost:    incoming.totalOpportunityCost,  // informativo
    totalLogisticCost:       incoming.totalLogisticCost,
    // Empezar el día en negativo por los costos reales (solo salarios; oportunidad es informativa)
    dailyNetProfit:          -incoming.dailyLaborCost,
    // Mantener la cola desde el estado anterior (se actualiza evento a evento)
    queueSize:               current.queueSize,
    // Llegadas del día: se conocen de inmediato (todos los dispositivos ya ingresaron)
    dailyArrivals:           incoming.dailyArrivals,
    // Contadores de clasificación/desguace parten en 0 (se acumulan con cada evento revelado)
    dailyCaseA:              0,
    dailyTerminalWaste:      0,
    dailyCaseB:              0,
    dailyDisassembled:       0,
    dailyCaseARevenue:       0,
    dailyMaterialRevenue:    0,
    // Los acumulados de ingresos se conservan del día anterior
    // (se irán sumando evento a evento)
  }
}

/**
 * Actualiza el snapshot incrementalmente al revelar un evento individual.
 * Así los paneles reflejan exactamente lo que ya se mostró en el log.
 */
function applyEventToSnapshot(snapshot: PlantSnapshot, event: DeviceEvent): PlantSnapshot {
  const s = { ...snapshot }

  if (event.eventType === 'TRIAGE') {
    s.totalArrived++   // acumulado histórico (dailyArrivals ya viene del snapshot)

    if (event.triageResult === 'CASO_A') {
      const rev = event.caseARevenue ?? 0
      s.dailyCaseA++
      s.totalCaseA++
      s.dailyCaseARevenue += rev
      s.totalCaseARevenue += rev
    } else if (event.triageResult === 'TERMINAL') {
      s.dailyTerminalWaste++
      s.totalTerminalWaste++
    } else if (event.triageResult === 'CASO_B') {
      s.dailyCaseB++
      s.queueSize++          // entra a la cola
    }
  } else if (event.eventType === 'DESGUACE') {
    const rev = event.materialRevenue ?? 0
    s.dailyDisassembled++
    s.totalDisassembled++
    s.dailyMaterialRevenue += rev
    s.totalMaterialRevenue += rev
    s.queueSize = Math.max(0, s.queueSize - 1)  // sale de la cola

    // Materiales recuperados (acumulado histórico)
    const mats = { ...snapshot.materialRecoveredKg }
    mats['plastico']  = (mats['plastico']  ?? 0) + (event.plasticKg   ?? 0)
    mats['ferroso']   = (mats['ferroso']   ?? 0) + (event.ferrousKg   ?? 0)
    mats['preciosos'] = (mats['preciosos'] ?? 0) + (event.preciousKg  ?? 0)
    mats['aluminio']  = (mats['aluminio']  ?? 0) + (event.aluminumKg  ?? 0)
    mats['cobre']     = (mats['cobre']     ?? 0) + (event.copperKg    ?? 0)
    s.materialRecoveredKg = mats
  }

  // Resultado neto del día: ingresos menos costos reales (opportunity es informativa)
  s.dailyNetProfit = s.dailyCaseARevenue + s.dailyMaterialRevenue - s.dailyLaborCost

  // Utilidad neta acumulada: solo se restan costos reales (salarios + logística)
  s.totalNetProfit = s.totalCaseARevenue + s.totalMaterialRevenue
    - s.totalLaborCost - s.totalLogisticCost

  return s
}

/**
 * Intercala TRIAGE y DESGUACE en orden cronológico y asigna caseBNum GLOBAL
 * (nunca se reinicia entre días) y workerSlot a cada evento.
 *
 * Cola persistente `pendingDisassemblyNums`:
 *   - Al entrar, contiene los caseBNums de dispositivos arrastrados de días
 *     anteriores (carry-overs), en orden FIFO = misma posición en la queue del backend.
 *   - Se añaden al final los caseBNums de los nuevos CASO_B de hoy.
 *   - disassemblyEvents[i] se corresponde con pendingDisassemblyNums[i].
 *   - Al salir, se recorta la cola eliminando los procesados hoy.
 *
 * Retorna los eventos ordenados por simTime más el mapa caseBNum → workerSlot
 * de los dispositivos procesados hoy (para asignar phantoms en ARRIVALS).
 */
function interleaveEvents(
  triageEvents: DeviceEvent[],
  disassemblyEvents: DeviceEvent[],
  dayNumber: number,
  triageOperators: number,
  activeStations: number,
  operatorsPerStation: number,
): { events: DeviceEvent[]; caseBSlotMap: Record<number, number> } {
  const SIM_START_MIN = 8 * 60

  // Carry-overs = dispositivos en cola antes de añadir los nuevos del día
  const numCarryOvers = pendingDisassemblyNums.length

  // Asignar caseBNums GLOBALES a los nuevos CASO_B de hoy
  const triageWithTime: DeviceEvent[] = triageEvents.map((e, i) => ({
    ...e,
    simTimeMinutes: SIM_START_MIN + (Math.floor(i / triageOperators) + 1) * 7.5,
    caseBNum: e.triageResult === 'CASO_B' ? ++globalCaseBCounter : undefined,
    dayNumber,
  }))

  // Añadir los nuevos caseBNums al final de la cola persistente
  triageWithTime
    .filter((e) => e.triageResult === 'CASO_B' && e.caseBNum != null)
    .forEach((e) => pendingDisassemblyNums.push(e.caseBNum!))

  // Tiempos de salida del triaje para los nuevos CASO_B (índice dentro de hoy)
  const caseBTriage    = triageWithTime.filter((e) => e.triageResult === 'CASO_B')
  const caseBExitRelMin = caseBTriage.map((e) => (e.simTimeMinutes ?? SIM_START_MIN) - SIM_START_MIN)

  const totalOps = activeStations * operatorsPerStation
  const opTime: number[] = new Array(totalOps).fill(0)

  const disassemblyWithTime: DeviceEvent[] = disassemblyEvents.map((e, caseBIdx) => {
    const procTime = e.processingTimeMinutes ?? 55

    // Carry-overs ya pasaron por triaje en días anteriores → triageExitRel = 0.
    // Los nuevos del día deben esperar a que su triaje termine.
    const triageExitRel = caseBIdx < numCarryOvers
      ? 0
      : caseBExitRelMin[caseBIdx - numCarryOvers] ?? 0

    // caseBNum desde la cola persistente (posición 1:1 con la queue del backend)
    const caseBNum = pendingDisassemblyNums[caseBIdx]

    let bestOp    = 0
    let bestStart = Infinity
    for (let i = 0; i < totalOps; i++) {
      const start = Math.max(opTime[i], triageExitRel)
      if (start + procTime <= 540 && start < bestStart) {
        bestStart = start
        bestOp    = i
      }
    }
    if (bestStart === Infinity) {
      bestOp    = opTime.indexOf(Math.min(...opTime))
      bestStart = Math.max(opTime[bestOp], triageExitRel)
    }
    opTime[bestOp] = bestStart + procTime

    return {
      ...e,
      simTimeMinutes: SIM_START_MIN + opTime[bestOp],
      caseBNum,
      workerSlot: bestOp,
      dayNumber,
    }
  })

  // Retirar los dispositivos procesados hoy de la cola persistente
  pendingDisassemblyNums = pendingDisassemblyNums.slice(disassemblyEvents.length)

  // Mapa caseBNum → workerSlot para todos los procesados hoy (carry-overs + nuevos)
  const caseBSlotMap: Record<number, number> = {}
  disassemblyWithTime.forEach((e) => {
    if (e.caseBNum != null && e.workerSlot != null) caseBSlotMap[e.caseBNum] = e.workerSlot
  })

  // Propagar workerSlot al TRIAGE CASO_B correspondiente (solo nuevos procesados hoy)
  const triageAnnotated = triageWithTime.map((e) =>
    e.triageResult === 'CASO_B' && e.caseBNum != null && caseBSlotMap[e.caseBNum] != null
      ? { ...e, workerSlot: caseBSlotMap[e.caseBNum] }
      : e
  )

  const events = [...triageAnnotated, ...disassemblyWithTime].sort(
    (a, b) => (a.simTimeMinutes ?? 0) - (b.simTimeMinutes ?? 0),
  )

  return { events, caseBSlotMap }
}

// ── Helpers de informe ───────────────────────────────────────────────────────

const MONTH_LABELS = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function buildMonthlySeries(daily: DailySeriesPoint[], durationYears: number): MonthlySeriesPoint[] {
  const map = new Map<string, { entry: MonthlySeriesPoint; queueSum: number; queueCount: number }>()

  for (const d of daily) {
    const yearIndex = Math.ceil(d.day / 365)
    const key = `${yearIndex}-${d.month}`

    if (!map.has(key)) {
      const label = durationYears > 1
        ? `${MONTH_LABELS[d.month]} A${yearIndex}`
        : MONTH_LABELS[d.month]
      map.set(key, {
        entry: {
          month: d.month, yearIndex, label,
          workDays: 0, suspensionDays: 0,
          arrivals: 0, caseA: 0, terminalWaste: 0, caseB: 0, disassembled: 0,
          avgQueueSize: 0, revenue: 0, cost: 0, netProfit: 0,
        },
        queueSum: 0,
        queueCount: 0,
      })
    }

    const rec = map.get(key)!
    const e = rec.entry
    e.arrivals     += d.arrivals
    e.caseA        += d.caseA
    e.terminalWaste += d.terminalWaste
    e.caseB        += d.caseB
    e.disassembled += d.disassembled
    e.revenue      += d.dailyRevenue
    e.cost         += d.dailyCost
    e.netProfit    += d.dailyNetProfit
    if (d.workDay) {
      e.workDays++
      if (d.suspended) e.suspensionDays++
      rec.queueSum   += d.queueSize
      rec.queueCount++
    }
  }

  for (const rec of map.values()) {
    rec.entry.avgQueueSize = rec.queueCount > 0 ? rec.queueSum / rec.queueCount : 0
  }

  return Array.from(map.values()).map((r) => r.entry)
}

function buildReportFromSnapshot(
  snapshot: PlantSnapshot,
  config: SimulationConfig,
  source: SimulationReport['source'],
): SimulationReport {
  return {
    source,
    config,
    totalArrived:        snapshot.totalArrived,
    totalCaseA:          snapshot.totalCaseA,
    totalTerminalWaste:  snapshot.totalTerminalWaste,
    totalCaseB:          snapshot.totalCaseB ?? (snapshot.totalArrived - snapshot.totalCaseA - snapshot.totalTerminalWaste),
    totalDisassembled:   snapshot.totalDisassembled,
    totalSuspensions:    snapshot.totalSuspensions,
    totalCaseARevenue:   snapshot.totalCaseARevenue,
    totalMaterialRevenue: snapshot.totalMaterialRevenue,
    totalLaborCost:      snapshot.totalLaborCost,
    totalOpportunityCost: snapshot.totalOpportunityCost,
    totalLogisticCost:   snapshot.totalLogisticCost,
    totalNetProfit:      snapshot.totalNetProfit,
    materialRecoveredKg: { ...snapshot.materialRecoveredKg },
    kpis:                snapshot.kpis,
    stations:            snapshot.stations,
    monthlySeries:       buildMonthlySeries(snapshot.dailySeries, config.simulationDurationYears),
    dailySeries:         snapshot.dailySeries,
  }
}

const BACKEND_URL = 'http://localhost:8080'

// ── Store ─────────────────────────────────────────────────────────────────────

interface SimulationState {
  config: SimulationConfig
  /**
   * Snapshot visible en los paneles. Se actualiza:
   * - Parcialmente (reloj + costos) cuando llega un snapshot del backend.
   * - Incrementalmente (ingresos, cantidades) al revelar cada evento en el log.
   * - Totalmente (valores autoritativos) cuando la cola de eventos se vacía.
   */
  snapshot: PlantSnapshot
  /** Último snapshot del backend, pendiente de aplicarse cuando la cola drene. */
  pendingSnapshot: PlantSnapshot | null
  isRunning: boolean
  isPaused: boolean
  /** Se incrementa en cada reset para que la animación pueda limpiar su estado. */
  resetKey: number
  error: string | null
  eventQueue: DeviceEvent[]
  visibleEvents: DeviceEvent[]
  /**
   * Intervalo adaptativo entre reveals (ms).
   * A 1× se calcula como (tickMs - 10 s) / eventCount para que los eventos
   * llenen exactamente el tick y haya una pausa natural de ~10 s entre días.
   * A otras velocidades usa la fórmula fija tickMs / 90.
   */
  revealIntervalMs: number
  /**
   * Timestamp (Date.now()) hasta el cual revealNextEvent debe hacer pausa.
   * Se activa al revelar el evento DAY_END a 1× para insertar los 10 s entre días.
   */
  revealPausedUntil: number | null

  report: SimulationReport | null
  isComputingReport: boolean

  reportHistory: SavedReport[]
  deleteReportFromHistory: (id: string) => void
  clearReportHistory: () => void

  initialize: () => () => void
  startSimulation: (config?: SimulationConfig) => Promise<void>
  stopSimulation: () => Promise<void>
  applyConfig: (config: SimulationConfig) => Promise<void>
  resetSimulation: () => Promise<void>
  pauseSimulation: () => Promise<void>
  resumeSimulation: () => Promise<void>
  revealNextEvent: () => void
  /** Detiene la animación y llama al backend /compute para generar el informe al instante. */
  computeReport: () => Promise<void>
  /** Descarta el informe, resetea la simulación y vuelve al dashboard. */
  dismissReport: () => void
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  config:              defaultConfig,
  snapshot:            createInitialSnapshot(defaultConfig),
  pendingSnapshot:     null,
  isRunning:           false,
  isPaused:            false,
  resetKey:            0,
  error:               null,
  eventQueue:          [],
  visibleEvents:       [],
  revealIntervalMs:    Math.max(50, Math.floor(defaultConfig.tickMs / 90)),
  revealPausedUntil:   null,
  report:              null,
  isComputingReport:   false,
  reportHistory:       loadHistory(),

  initialize: () =>
    transport.subscribe((incoming) => {
      const allEvents = incoming.deviceEvents ?? []
      const { tickMs, triageOperators, activeStations, operatorsPerStation } = get().config

      // Separar por tipo de evento
      const triageEvents      = allEvents.filter((e) => e.eventType === 'TRIAGE')
      const disassemblyEvents = allEvents.filter((e) => e.eventType === 'DESGUACE')
      const triage_summary    = allEvents.filter((e) => e.eventType === 'TRIAGE_SUMMARY')
      const oppInfoEvents     = allEvents.filter((e) => e.eventType === 'OPPORTUNITY_INFO')
      const suspEndEvents     = allEvents.filter((e) => e.eventType === 'SUSPENSION_END')

      const dayNum = incoming.currentDay
      const tagAt = (e: DeviceEvent, simMin: number): DeviceEvent =>
        ({ ...e, dayNumber: dayNum, simTimeMinutes: simMin })

      // Calcular el tiempo sim al final del triaje (para ubicar el resumen después)
      const triageEndMin = 8 * 60 + (Math.ceil(triageEvents.length / triageOperators)) * 7.5

      // Oportunidad info al inicio del día, resumen de triaje al final del triaje, cargo logístico al final
      const { events: interleavedCore, caseBSlotMap } = interleaveEvents(
        triageEvents, disassemblyEvents, dayNum, triageOperators, activeStations, operatorsPerStation,
      )
      const interleaved: DeviceEvent[] = [
        ...oppInfoEvents.map((e) => tagAt(e, 8 * 60)),
        ...interleavedCore,
        ...triage_summary.map((e)  => tagAt(e, triageEndMin)),
        ...suspEndEvents.map((e)   => tagAt(e, 17 * 60)),
      ]

      // ── Intervalo adaptativo ───────────────────────────────────────────────
      // Días no laborables (fin de semana / feriado): sólo tienen 2 sentinels
      // (ARRIVALS + DAY_END), se revelan rápido — 200 ms cada uno.
      // Días hábiles a 1×: reservamos 5 s para la pausa de fin de día y
      // distribuimos el resto entre los eventos para que llenen exactamente el tick.
      // Otras velocidades: fórmula fija (tickMs / 90); la pausa de 5 s aplica igual.
      const IS_1X       = tickMs === 1_620_000
      const eventCount  = Math.max(1, interleaved.length)
      const newRevealMs = !incoming.workDay
        ? 200                                                            // no laborable: rápido
        : IS_1X
          ? Math.max(200, Math.round(tickMs / eventCount))              // 1× adaptativo
          : Math.max(50,  Math.floor(tickMs / 90))                      // ×N fórmula fija

      // ── Sentinels sintéticos ───────────────────────────────────────────────
      const arrivalsSentinel: DeviceEvent = {
        seq:            -1,
        eventType:      'ARRIVALS',
        dayNumber:      incoming.currentDay,
        simTimeMinutes: 8 * 60,
        arrivalsCount:  incoming.dailyArrivals,
        workDay:        incoming.workDay,
        holidayName:    incoming.holidayName,
        // suspended = true si la planta estaba bajo clausura AL INICIO del día
        // (dailyOpportunityInfo > 0 cubre el último día donde suspended ya es false)
        suspended:      incoming.suspended || incoming.dailyOpportunityInfo > 0,
        dayOfMonth:     incoming.dayOfMonth,
        currentMonth:   incoming.currentMonth,
        // Mapa caseBNum → workerSlot para asignar phantoms a carry-overs al inicio del día
        caseBSlotMap:   Object.keys(caseBSlotMap).length > 0 ? caseBSlotMap : undefined,
      }
      const dayEndSentinel: DeviceEvent = {
        seq:            -2,
        eventType:      'DAY_END',
        dayNumber:      incoming.currentDay,
        simTimeMinutes: 17 * 60,
        workDay:        incoming.workDay,
        suspended:      incoming.suspended || incoming.dailyOpportunityInfo > 0,
      }

      // Guardar el snapshot del día para aplicarlo cuando ARRIVALS sea sacado de la cola.
      // Si llega día 3 antes de que el día 2 se procese, cada día tiene su propia entrada.
      pendingDaySnapshots.set(incoming.currentDay, incoming)

      set((prev) => ({
        // No tocamos snapshot ni visibleEvents aquí: los eventos del día anterior
        // aún pueden estar en la cola y deben mostrarse ANTES de este día.
        // ARRIVALS va al final de la cola para salir en orden correcto.
        error:             null,
        eventQueue:        [...prev.eventQueue, arrivalsSentinel, ...interleaved, dayEndSentinel],
        revealIntervalMs:  newRevealMs,
        revealPausedUntil: null,
      }))

      if (incoming.isCompleted) {
        transport.stopRun().then(() => set({ isRunning: false }))
      }
    }),

  startSimulation: async (overrideConfig?: SimulationConfig) => {
    const { isRunning } = get()
    if (isRunning) return
    const cfg = overrideConfig ?? get().config
    resetCaseBState()
    set({
      ...(overrideConfig ? { config: overrideConfig } : {}),
      snapshot:          createInitialSnapshot(cfg),
      pendingSnapshot:   null,
      eventQueue:        [],
      visibleEvents:     [],
      isPaused:          false,
      revealPausedUntil: null,
    })
    await transport.startRun(cfg)
    set({ isRunning: true, error: null })
  },

  stopSimulation: async () => {
    await transport.stopRun()
    pendingDaySnapshots.clear()
    resetCaseBState()
    set({ isRunning: false, isPaused: false, error: null, eventQueue: [], pendingSnapshot: null, revealPausedUntil: null })
  },

  pauseSimulation: async () => {
    await transport.pauseRun()
    set({ isPaused: true, error: null })
  },

  resumeSimulation: async () => {
    await transport.resumeRun()
    set({ isPaused: false, error: null })
  },

  applyConfig: async (nextConfig: SimulationConfig) => {
    const { isRunning } = get()
    set({ config: nextConfig, error: null })
    if (isRunning) {
      await transport.updateConfig(nextConfig)
      return
    }
    set({ snapshot: createInitialSnapshot(nextConfig), pendingSnapshot: null })
  },

  resetSimulation: async () => {
    const { config, isRunning, resetKey } = get()
    pendingDaySnapshots.clear()
    resetCaseBState()
    set({
      snapshot:        createInitialSnapshot(config),
      pendingSnapshot: null,
      eventQueue:      [],
      visibleEvents:   [],
      isPaused:        false,
      revealPausedUntil: null,
      resetKey:        resetKey + 1,
    })
    if (isRunning) {
      await transport.stopRun()
      await transport.startRun(config)
    }
  },

  revealNextEvent: () => {
    const { eventQueue, visibleEvents, pendingSnapshot, snapshot, revealPausedUntil, config } = get()

    // Durante la pausa de fin de día no hacemos nada; el setInterval sigue
    // llamando esta función pero la descartamos hasta que expire el timer.
    if (revealPausedUntil !== null && Date.now() < revealPausedUntil) return

    // Limpiar la pausa una vez expirada
    if (revealPausedUntil !== null) set({ revealPausedUntil: null })

    if (eventQueue.length === 0) {
      // Cola vacía: aplicar el snapshot autoritativo del backend
      if (pendingSnapshot) {
        const wasCompleted = pendingSnapshot.isCompleted
        set({ snapshot: pendingSnapshot, pendingSnapshot: null })
        // Auto-trigger: simulación completada → mostrar informe tras 2 s
        if (wasCompleted) {
          setTimeout(() => {
            const { snapshot: final, config, reportHistory } = get()
            const report = buildReportFromSnapshot(final, config, 'run')
            const entry: SavedReport = { id: Date.now().toString(), savedAt: new Date().toISOString(), report }
            const newHistory = [entry, ...reportHistory]
            persistHistory(newHistory)
            set({ report, reportHistory: newHistory })
          }, 2_000)
        }
      }
      return
    }

    const [next, ...rest] = eventQueue

    // ── Evento especial: inicio de jornada ───────────────────────────────────
    // Aquí —y solo aquí— se aplican reloj + costos del nuevo día, con el
    // queueSize correcto (el día anterior ya drenó por completo).
    if (next.eventType === 'ARRIVALS') {
      const incomingDay = pendingDaySnapshots.get(next.dayNumber ?? 0)
      pendingDaySnapshots.delete(next.dayNumber ?? 0)
      const base = incomingDay ? applyClockAndCosts(snapshot, incomingDay) : snapshot
      set({
        snapshot:        base,
        pendingSnapshot: incomingDay ?? pendingSnapshot,
        eventQueue:      rest,
        visibleEvents:   [...visibleEvents, next].slice(-120),
      })
      return
    }

    // ── Evento especial: fin de jornada ──────────────────────────────────────
    // Días hábiles: pausa de 5 s siempre (todas las velocidades).
    // Días no laborables (finde / feriado):
    //   - A 1×: pausa de 5 s para que el día sea visible en la animación.
    //   - Otras velocidades: sin pausa, pasan de inmediato.
    if (next.eventType === 'DAY_END') {
      const isAnimMode = config.tickMs === 1_620_000 || config.tickMs === 162_000
      const pauseMs = next.suspended          ? 0       // clausura: sin pausa entre días
                    : next.workDay !== false  ? 6_000
                    : isAnimMode             ? 6_000
                    : 0
      set({
        eventQueue:        rest,
        visibleEvents:     [...visibleEvents, next].slice(-120),
        revealPausedUntil: pauseMs > 0 ? Date.now() + pauseMs : null,
      })
      return
    }

    // Actualizar paneles económicos de forma incremental con este evento
    const updatedSnapshot = applyEventToSnapshot(snapshot, next)
    set({
      eventQueue:    rest,
      visibleEvents: [...visibleEvents, next].slice(-120),
      snapshot:      updatedSnapshot,
    })
  },

  computeReport: async () => {
    const { config } = get()
    set({ isComputingReport: true })
    // Detener la animación actual si está corriendo
    await transport.stopRun().catch(() => {})
    pendingDaySnapshots.clear()
    resetCaseBState()
    set({ isRunning: false, isPaused: false, eventQueue: [], revealPausedUntil: null })

    try {
      const res = await fetch(`${BACKEND_URL}/api/simulations/compute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      // Mapear la respuesta del backend al tipo SimulationReport del frontend
      const report: SimulationReport = {
        source:              'computed',
        config,
        totalArrived:        data.totalArrived,
        totalCaseA:          data.totalCaseA,
        totalTerminalWaste:  data.totalTerminalWaste,
        totalCaseB:          data.totalCaseB,
        totalDisassembled:   data.totalDisassembled,
        totalSuspensions:    data.totalSuspensions,
        totalCaseARevenue:   data.totalCaseARevenue,
        totalMaterialRevenue: data.totalMaterialRevenue,
        totalLaborCost:      data.totalLaborCost,
        totalOpportunityCost: data.totalOpportunityCost,
        totalLogisticCost:   data.totalLogisticCost,
        totalNetProfit:      data.totalNetProfit,
        materialRecoveredKg: data.materialRecoveredKg ?? {},
        kpis:                data.kpis,
        stations:            data.stations ?? [],
        monthlySeries:       buildMonthlySeries(data.dailySeries ?? [], config.simulationDurationYears),
        dailySeries:         data.dailySeries ?? [],
      }
      const { reportHistory } = get()
      const entry: SavedReport = { id: Date.now().toString(), savedAt: new Date().toISOString(), report }
      const newHistory = [entry, ...reportHistory]
      persistHistory(newHistory)
      set({ report, isComputingReport: false, reportHistory: newHistory })
    } catch (err) {
      set({ isComputingReport: false, error: String(err) })
    }
  },

  dismissReport: () => {
    const { config, resetKey } = get()
    pendingDaySnapshots.clear()
    resetCaseBState()
    set({
      report:            null,
      snapshot:          createInitialSnapshot(config),
      pendingSnapshot:   null,
      eventQueue:        [],
      visibleEvents:     [],
      isPaused:          false,
      revealPausedUntil: null,
      isRunning:         false,
      resetKey:          resetKey + 1,
    })
  },

  deleteReportFromHistory: (id: string) => {
    const { reportHistory } = get()
    const newHistory = reportHistory.filter((e) => e.id !== id)
    persistHistory(newHistory)
    set({ reportHistory: newHistory })
  },

  clearReportHistory: () => {
    persistHistory([])
    set({ reportHistory: [] })
  },
}))
