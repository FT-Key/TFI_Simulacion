import { create } from 'zustand'
import { createSimulationTransport } from '../services/transport'
import type {
  DeviceEvent,
  DailySeriesPoint,
  MonthlySeriesPoint,
  PlantSnapshot,
  SimulationConfig,
  SimulationReport,
  StationSnapshot,
} from '../types/simulation'
export type { SimulationConfig }

const transport = createSimulationTransport()

/**
 * Mapa módulo-nivel: almacena el snapshot incoming de cada día hasta que
 * el sentinel ARRIVALS de ese día es sacado de la cola y procesado.
 * Así applyClockAndCosts se ejecuta con el queueSize correcto (ya drenado
 * el día anterior) y no "contamina" las métricas del día anterior.
 */
const pendingDaySnapshots = new Map<number, PlantSnapshot>()

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
  dailySuspensionCost: 0,
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
    // dailySeries y kpis se aplican al FINAL del día (vía pendingSnapshot),
    // no al inicio, para que el gráfico solo muestre días completados.
    dailySeries:             current.dailySeries,
    stations:                incoming.stations,
    kpis:                    incoming.kpis,
    // Costos laborales: fijos para el día, se aplican de inmediato
    dailyLaborCost:          incoming.dailyLaborCost,
    dailySuspensionCost:     incoming.dailySuspensionCost,
    totalLaborCost:          incoming.totalLaborCost,
    totalOpportunityCost:    incoming.totalOpportunityCost,
    totalLogisticCost:       incoming.totalLogisticCost,
    // Empezar el día en negativo por los costos (mejorará con cada ingreso revelado)
    dailyNetProfit:          -(incoming.dailyLaborCost + incoming.dailySuspensionCost),
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

  // Resultado neto del día: ingresos menos costos ya conocidos
  s.dailyNetProfit = s.dailyCaseARevenue + s.dailyMaterialRevenue
    - s.dailyLaborCost - s.dailySuspensionCost

  // Utilidad neta acumulada
  s.totalNetProfit = s.totalCaseARevenue + s.totalMaterialRevenue
    - s.totalLaborCost - s.totalOpportunityCost - s.totalLogisticCost

  return s
}

/**
 * Intercala los eventos de TRIAGE y DESGUACE en orden cronológico simulado
 * y asigna a cada evento su tiempo simulado (minutos desde medianoche) y el día.
 *
 * Tiempos simulados:
 *   - Triage[i]: 08:00 + (floor(i / triageOperators) + 1) × 6 min
 *     → triageOperators clasifican en paralelo: cada 6 min sim terminan triageOperators equipos.
 *   - DESGUACE[j]: 08:00 + tiempo acumulado de la estación a la que fue asignado.
 *     → se simulan activeStations estaciones en paralelo con la misma lógica FIFO del backend.
 */
function interleaveEvents(
  triageEvents: DeviceEvent[],
  disassemblyEvents: DeviceEvent[],
  dayNumber: number,
  triageOperators: number,
  activeStations: number,
  operatorsPerStation: number,
): DeviceEvent[] {
  const SIM_START_MIN = 8 * 60  // 08:00 en minutos desde medianoche

  // Triage: triageOperators operarios en paralelo → cada 6 min sim terminan triageOperators equipos
  const triageWithTime: DeviceEvent[] = triageEvents.map((e, i) => ({
    ...e,
    simTimeMinutes: SIM_START_MIN + (Math.floor(i / triageOperators) + 1) * 6,
    dayNumber,
  }))

  // Desguace: simular estaciones con operarios en paralelo dentro de cada estación.
  // Cada operario tiene su propio reloj; el dispositivo se asigna al operario libre más temprano
  // dentro de la estación activa. El cambio de estación sigue la misma lógica FIFO del backend.
  const stationCapacity = operatorsPerStation * 540  // capacidad total por estación (min/día)

  // workerTimes[s][op] = minutos acumulados del operario op en la estación s (arranca 08:06)
  const workerTimes: number[][] = Array.from(
    { length: activeStations },
    () => new Array(operatorsPerStation).fill(6),
  )

  let stationIdx = 0
  let remaining = stationCapacity

  const disassemblyWithTime: DeviceEvent[] = disassemblyEvents.map((e) => {
    const procTime = e.processingTimeMinutes ?? 55
    // Si no cabe en la estación actual, pasar a la siguiente (mismo criterio que el backend)
    if (remaining < procTime && stationIdx < activeStations - 1) {
      stationIdx++
      remaining = stationCapacity
    }
    remaining -= procTime

    // Asignar al operario más libre de esta estación
    const ops = workerTimes[stationIdx]
    const minTime = Math.min(...ops)
    const opIdx = ops.indexOf(minTime)
    ops[opIdx] += procTime

    return {
      ...e,
      simTimeMinutes: SIM_START_MIN + ops[opIdx],
      dayNumber,
    }
  })

  // Unir y ordenar por tiempo simulado para que el log respete el orden cronológico
  return [...triageWithTime, ...disassemblyWithTime].sort(
    (a, b) => (a.simTimeMinutes ?? 0) - (b.simTimeMinutes ?? 0),
  )
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
  /** Descarta el informe y vuelve al dashboard. */
  dismissReport: () => void
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  config:              defaultConfig,
  snapshot:            createInitialSnapshot(defaultConfig),
  pendingSnapshot:     null,
  isRunning:           false,
  isPaused:            false,
  error:               null,
  eventQueue:          [],
  visibleEvents:       [],
  revealIntervalMs:    Math.max(50, Math.floor(defaultConfig.tickMs / 90)),
  revealPausedUntil:   null,
  report:              null,
  isComputingReport:   false,

  initialize: () =>
    transport.subscribe((incoming) => {
      const allEvents = incoming.deviceEvents ?? []
      const { tickMs, triageOperators, activeStations, operatorsPerStation } = get().config

      // Separar por tipo de evento
      const triageEvents      = allEvents.filter((e) => e.eventType === 'TRIAGE')
      const disassemblyEvents = allEvents.filter((e) => e.eventType === 'DESGUACE')
      const suspDayEvents     = allEvents.filter((e) => e.eventType === 'SUSPENSION_DAY')
      const suspEndEvents     = allEvents.filter((e) => e.eventType === 'SUSPENSION_END')

      const dayNum = incoming.currentDay
      const tagSusp = (e: DeviceEvent, simMin: number): DeviceEvent =>
        ({ ...e, dayNumber: dayNum, simTimeMinutes: simMin })

      // Suspensión al inicio del día, desguace intercalado, cargo logístico al final
      const interleaved: DeviceEvent[] = [
        ...suspDayEvents.map((e) => tagSusp(e, 8 * 60)),
        ...interleaveEvents(triageEvents, disassemblyEvents, dayNum, triageOperators, activeStations, operatorsPerStation),
        ...suspEndEvents.map((e) => tagSusp(e, 17 * 60)),
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
        // (dailySuspensionCost > 0 cubre el último día donde suspended ya es false)
        suspended:      incoming.suspended || incoming.dailySuspensionCost > 0,
      }
      const dayEndSentinel: DeviceEvent = {
        seq:            -2,
        eventType:      'DAY_END',
        dayNumber:      incoming.currentDay,
        simTimeMinutes: 17 * 60,
        workDay:        incoming.workDay,
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
    const { config, isRunning } = get()
    pendingDaySnapshots.clear()
    set({
      snapshot:        createInitialSnapshot(config),
      pendingSnapshot: null,
      eventQueue:      [],
      visibleEvents:   [],
      isPaused:        false,
      revealPausedUntil: null,
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
            const { snapshot: final, config } = get()
            const report = buildReportFromSnapshot(final, config, 'run')
            set({ report })
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
    // La pausa de 10 s entre días sólo aplica a jornadas laborables a 1×.
    // Días no laborables (fin de semana / feriado): sin pausa, pasan de inmediato.
    // Días hábiles: 5 s fijos sin importar la velocidad, para poder pausar y revisar.
    if (next.eventType === 'DAY_END') {
      const pauseMs = next.workDay !== false ? 5_000 : 0
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
      set({ report, isComputingReport: false })
    } catch (err) {
      set({ isComputingReport: false, error: String(err) })
    }
  },

  dismissReport: () => {
    set({ report: null })
  },
}))
