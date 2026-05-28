import { create } from 'zustand'
import { createSimulationTransport } from '../services/transport'
import type { DeviceEvent, PlantSnapshot, SimulationConfig, StationSnapshot } from '../types/simulation'
export type { SimulationConfig }

const transport = createSimulationTransport()

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
  dayOfWeek: 1,
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
    dayOfWeek:               incoming.dayOfWeek,
    peakMonth:               incoming.peakMonth,
    workDay:                 incoming.workDay,
    isCompleted:             incoming.isCompleted,
    suspended:               incoming.suspended,
    suspensionDaysRemaining: incoming.suspensionDaysRemaining,
    totalSuspensions:        incoming.totalSuspensions,
    dailySeries:             incoming.dailySeries,
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
    // Los contadores diarios de ingresos/cantidades parten de 0
    dailyArrivals:           0,
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
    s.dailyArrivals++
    s.totalArrived++

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
 *   - Triage[i]: 08:00 + i × 6 min  (triageIntervalMs / msPerSimMin = 540/90 = 6, constante)
 *   - DESGUACE[j]: 08:00 + Σ processingTimeMinutes[0..j]  (estación ocupada desde el inicio)
 *
 * La relación triageIntervalMs / msPerSimMin es siempre 6 min sim (independiente de tickMs),
 * por lo que los tiempos mostrados son invariantes a la velocidad elegida.
 */
function interleaveEvents(
  triageEvents: DeviceEvent[],
  disassemblyEvents: DeviceEvent[],
  tickMs: number,
  dayNumber: number,
): DeviceEvent[] {
  const SIM_START_MIN = 8 * 60  // 08:00 en minutos desde medianoche

  if (disassemblyEvents.length === 0) {
    return triageEvents.map((e, i) => ({
      ...e,
      simTimeMinutes: SIM_START_MIN + i * 6,
      dayNumber,
    }))
  }
  if (triageEvents.length === 0) {
    let cumSimMin = 0
    return disassemblyEvents.map((e) => {
      cumSimMin += (e.processingTimeMinutes ?? 55)
      return { ...e, simTimeMinutes: SIM_START_MIN + cumSimMin, dayNumber }
    })
  }

  const triageIntervalMs = Math.max(50, Math.floor(tickMs / 90))
  const msPerSimMin      = tickMs / (9 * 60)

  const result: DeviceEvent[] = []
  let triageIndex = 0
  let cumulativeMs = 0

  for (const disassembly of disassemblyEvents) {
    // Tiempo acumulado (ms reales) hasta que termina este desguace
    cumulativeMs += (disassembly.processingTimeMinutes ?? 55) * msPerSimMin
    // Cuántos eventos de triage caben en ese tiempo
    const triageBefore = Math.floor(cumulativeMs / triageIntervalMs)

    while (triageIndex < triageBefore && triageIndex < triageEvents.length) {
      result.push({
        ...triageEvents[triageIndex],
        simTimeMinutes: SIM_START_MIN + triageIndex * 6,
        dayNumber,
      })
      triageIndex++
    }
    result.push({
      ...disassembly,
      simTimeMinutes: SIM_START_MIN + Math.round(cumulativeMs / msPerSimMin),
      dayNumber,
    })
  }

  // Triage restante (dispositivos que aún no tienen desguace hoy)
  while (triageIndex < triageEvents.length) {
    result.push({
      ...triageEvents[triageIndex],
      simTimeMinutes: SIM_START_MIN + triageIndex * 6,
      dayNumber,
    })
    triageIndex++
  }

  return result
}

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
  error: string | null
  eventQueue: DeviceEvent[]
  visibleEvents: DeviceEvent[]

  initialize: () => () => void
  startSimulation: (config?: SimulationConfig) => Promise<void>
  stopSimulation: () => Promise<void>
  applyConfig: (config: SimulationConfig) => Promise<void>
  resetSimulation: () => Promise<void>
  revealNextEvent: () => void
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  config:          defaultConfig,
  snapshot:        createInitialSnapshot(defaultConfig),
  pendingSnapshot: null,
  isRunning:       false,
  error:           null,
  eventQueue:      [],
  visibleEvents:   [],

  initialize: () =>
    transport.subscribe((incoming) => {
      const allEvents = incoming.deviceEvents ?? []
      const tickMs    = get().config.tickMs

      // Separar y reordenar cronológicamente triage + desguace
      const triageEvents     = allEvents.filter((e) => e.eventType === 'TRIAGE')
      const disassemblyEvents = allEvents.filter((e) => e.eventType === 'DESGUACE')
      const interleaved      = interleaveEvents(triageEvents, disassemblyEvents, tickMs, incoming.currentDay)

      const [first, ...rest] = interleaved

      set((prev) => {
        // Base: reloj + costos del día aplicados de inmediato
        const base = applyClockAndCosts(prev.snapshot, incoming)
        // El primer evento se revela de inmediato para dar feedback visual al usuario
        const withFirst = first ? applyEventToSnapshot(base, first) : base

        return {
          snapshot:        withFirst,
          pendingSnapshot: incoming,
          error:           null,
          visibleEvents:   first
            ? [...prev.visibleEvents, first].slice(-120)
            : prev.visibleEvents,
          eventQueue: [...prev.eventQueue, ...rest],
        }
      })

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
      snapshot:        createInitialSnapshot(cfg),
      pendingSnapshot: null,
      eventQueue:      [],
      visibleEvents:   [],
    })
    await transport.startRun(cfg)
    set({ isRunning: true, error: null })
  },

  stopSimulation: async () => {
    await transport.stopRun()
    set({ isRunning: false, error: null })
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
    set({
      snapshot:        createInitialSnapshot(config),
      pendingSnapshot: null,
      eventQueue:      [],
      visibleEvents:   [],
    })
    if (isRunning) {
      await transport.stopRun()
      await transport.startRun(config)
    }
  },

  revealNextEvent: () => {
    const { eventQueue, visibleEvents, pendingSnapshot, snapshot } = get()

    if (eventQueue.length === 0) {
      // Cola vacía: aplicar el snapshot autoritativo del backend para corregir
      // cualquier diferencia de redondeo en los valores acumulados
      if (pendingSnapshot) {
        set({ snapshot: pendingSnapshot, pendingSnapshot: null })
      }
      return
    }

    const [next, ...rest] = eventQueue
    // Actualizar paneles económicos de forma incremental con este evento
    const updatedSnapshot = applyEventToSnapshot(snapshot, next)

    set({
      eventQueue:    rest,
      visibleEvents: [...visibleEvents, next].slice(-120),
      snapshot:      updatedSnapshot,
    })
  },
}))
