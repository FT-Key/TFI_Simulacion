import type {
  ComparisonPoint,
  MaterialCategory,
  PlantSnapshot,
  SimulationConfig,
  SimulationGranularity,
  StationSnapshot,
  WeeklyPerformancePoint,
} from '../../types/simulation'

const MATERIALS: MaterialCategory[] = [
  'metales',
  'plastico',
  'partes',
  'vidrio',
  'aluminio',
  'cobre',
]

const BASELINE_RECOVERY_BY_MATERIAL: Record<MaterialCategory, number> = {
  metales: 82_000,
  plastico: 46_000,
  partes: 33_000,
  vidrio: 21_000,
  aluminio: 28_000,
  cobre: 35_000,
}

/** Ticks totales para simular un año completo según granularidad. */
function ticksPerYear(granularity: SimulationGranularity): number {
  switch (granularity) {
    case 'daily':   return 2080  // 260 días hábiles × 8 horas
    case 'weekly':  return 260   // 260 días hábiles
    case 'monthly': return 52    // 52 semanas
  }
}

/**
 * Convierte un tick absoluto + granularidad en métricas de reloj simulado.
 * daily:   1 tick = 1 hora  → day = floor(tick/8)+1, week = floor(tick/40)+1
 * weekly:  1 tick = 1 día   → day = tick+1, week = floor(tick/5)+1
 * monthly: 1 tick = 1 semana → week = tick+1
 */
function clockFromTick(tick: number, g: SimulationGranularity) {
  switch (g) {
    case 'daily': {
      const simulatedHour  = tick % 8
      const simulatedDay   = Math.floor(tick / 8) + 1
      const simulatedWeek  = Math.floor(tick / 40) + 1
      const simulatedMonth = Math.floor(tick / 160) + 1
      return { simulatedHour, simulatedDay, simulatedWeek, simulatedMonth }
    }
    case 'weekly': {
      const simulatedHour  = 0
      const simulatedDay   = tick + 1
      const simulatedWeek  = Math.floor(tick / 5) + 1
      const simulatedMonth = Math.floor(tick / 20) + 1
      return { simulatedHour, simulatedDay, simulatedWeek, simulatedMonth }
    }
    case 'monthly': {
      const simulatedHour  = 0
      const simulatedDay   = (tick + 1) * 5
      const simulatedWeek  = tick + 1
      const simulatedMonth = Math.floor(tick / 4) + 1
      return { simulatedHour, simulatedDay, simulatedWeek, simulatedMonth }
    }
  }
}

/** Label del eje X del gráfico de serie temporal según granularidad. */
function periodLabel(tick: number, g: SimulationGranularity): string {
  switch (g) {
    case 'daily':   return `H${tick + 1}`
    case 'weekly':  return `D${tick + 1}`
    case 'monthly': return `S${tick + 1}`
  }
}

/** Capacidad de procesamiento teórica por tick, en dispositivos. */
function theoreticalCapacityPerTick(config: SimulationConfig): number {
  const { activeStations, operatorsPerStation, granularity } = config
  const minutesPerTick = { daily: 60, weekly: 480, monthly: 2400 }[granularity]
  const avgProcessingMin = 55
  return (activeStations * operatorsPerStation * minutesPerTick) / avgProcessingMin
}

/** Llegadas brutas por tick (sin estacionalidad, sin ruido). */
function baseArrivalsPerTick(config: SimulationConfig): number {
  const { monthlyDeviceVolume, granularity } = config
  const divisor = { daily: 160, weekly: 20, monthly: 4 }[granularity]
  return monthlyDeviceVolume / divisor
}

/** Máxima cantidad de puntos en la serie temporal. */
const MAX_SERIES: Record<SimulationGranularity, number> = {
  daily: 24,
  weekly: 30,
  monthly: 52,
}

export class MockSimulationEngine {
  private config: SimulationConfig
  private tick = 0
  private queueDevices = 0
  private rollingPoints: WeeklyPerformancePoint[] = []
  private totalRecoveredValueUsd = 0
  private totalArrived = 0
  private totalDisassembled = 0
  private totalRefurbished = 0
  private totalWaste = 0

  constructor(config: SimulationConfig) {
    this.config = config
    this.queueDevices = Math.max(10, Math.round(baseArrivalsPerTick(config) * 2))
  }

  reconfigure(nextConfig: SimulationConfig) {
    this.config = nextConfig
    this.reset()
  }

  reset() {
    this.tick = 0
    this.queueDevices = Math.max(10, Math.round(baseArrivalsPerTick(this.config) * 2))
    this.rollingPoints = []
    this.totalRecoveredValueUsd = 0
    this.totalArrived = 0
    this.totalDisassembled = 0
    this.totalRefurbished = 0
    this.totalWaste = 0
  }

  step(): PlantSnapshot {
    const { granularity, simulationDurationYears } = this.config
    const maxTicks = ticksPerYear(granularity) * simulationDurationYears
    const isCompleted = this.tick >= maxTicks

    // Calcular métricas de reloj
    const clock = clockFromTick(this.tick, granularity)

    // Estacionalidad: picos en meses 1, 6, 7, 12
    const peakMonths = [1, 6, 7, 12]
    const currentMonth = ((clock.simulatedMonth - 1) % 12) + 1
    const seasonalFactor = peakMonths.includes(currentMonth)
      ? 1.0 + 0.2 * Math.abs(Math.sin(this.tick / 10))
      : 1.0

    // Llegadas y procesamiento
    const baseArrivals   = baseArrivalsPerTick(this.config)
    const noise          = 1 + 0.25 * Math.sin(this.tick / 3) + 0.15 * Math.cos(this.tick / 5)
    const incomingPerTick = Math.max(0, Math.round(baseArrivals * seasonalFactor * noise))

    const capacity    = theoreticalCapacityPerTick(this.config)
    const stressLoad  = 0.8 + 0.25 * Math.abs(Math.sin(this.tick / 4))
    const processedPerTick = Math.min(
      Math.round(capacity * stressLoad),
      this.queueDevices + incomingPerTick,
    )

    // Clasificación de llegadas (aproximación probabilística)
    const refurbishedThisTick = Math.round(incomingPerTick * 0.20)
    const wasteThisTick       = Math.round(incomingPerTick * 0.24)
    const toQueueThisTick     = incomingPerTick - refurbishedThisTick - wasteThisTick

    this.queueDevices = Math.max(0, this.queueDevices + toQueueThisTick - processedPerTick)
    this.totalArrived      += incomingPerTick
    this.totalRefurbished  += refurbishedThisTick
    this.totalWaste        += wasteThisTick
    this.totalDisassembled += processedPerTick

    // Materiales recuperados por tick
    const avgWeightKg = 18 // promedio ponderado: 0.3*5 + 0.5*15 + 0.2*57.5 ≈ 20.5, simplificado
    const recoveryValuePerDevice = avgWeightKg * (0.5 * 0.20 + 0.275 * 0.15 + 0.075 * 8 + 0.02 * 1.80 + 0.02 * 7)
    this.totalRecoveredValueUsd += processedPerTick * recoveryValuePerDevice

    // KPIs acumulados
    const total = this.totalArrived
    const kpis = {
      recoveredPct:    total > 0 ? Number(((this.totalDisassembled / total) * 100).toFixed(1)) : 0,
      refurbishedPct:  total > 0 ? Number(((this.totalRefurbished  / total) * 100).toFixed(1)) : 0,
      discardedPct:    total > 0 ? Number(((this.totalWaste         / total) * 100).toFixed(1)) : 0,
    }

    // Estaciones
    const stationLoad = Math.min(1, processedPerTick / Math.max(1, capacity))
    const stations    = this.buildStations(stationLoad)

    // Gráfico de comparación
    const comparisonSeries = this.buildComparisonSeries(kpis.recoveredPct)

    // Serie temporal
    this.pushPoint({
      week: periodLabel(this.tick, granularity),
      processed: processedPerTick,
      queued: this.queueDevices,
      discarded: wasteThisTick,
    }, granularity)

    this.tick += 1

    return {
      tick: this.tick,
      ...clock,
      granularity,
      isCompleted,
      queueDevices: this.queueDevices,
      incomingDevicesPerWeek: incomingPerTick,
      processedDevicesPerWeek: processedPerTick,
      stations,
      kpis,
      weeklySeries: [...this.rollingPoints],
      comparisonSeries,
      totalRecoveredValueUsd: this.totalRecoveredValueUsd,
      totalArrived: this.totalArrived,
      totalDisassembled: this.totalDisassembled,
      totalRefurbished: this.totalRefurbished,
      totalTerminalWaste: this.totalWaste,
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildStations(loadFactor: number): StationSnapshot[] {
    return Array.from({ length: this.config.activeStations }, (_, index) => ({
      id: index + 1,
      operatorsAssigned: this.config.operatorsPerStation,
      busyOperators: Math.max(
        0,
        Math.min(
          this.config.operatorsPerStation,
          Math.round(this.config.operatorsPerStation * loadFactor),
        ),
      ),
      completedDevices: Math.round(14 + 20 * loadFactor + ((index + this.tick) % 7)),
    }))
  }

  private buildComparisonSeries(recoveredPct: number): ComparisonPoint[] {
    const factor = recoveredPct / 100
    return MATERIALS.map((category, index) => {
      const base = BASELINE_RECOVERY_BY_MATERIAL[category]
      const wave = 0.92 + 0.2 * Math.sin((this.tick + index) / 4)
      return {
        category,
        currentScenario: Math.round(base * factor * wave),
        baselineDiscardAll: 0,
      }
    })
  }

  private pushPoint(point: WeeklyPerformancePoint, granularity: SimulationGranularity) {
    const max  = MAX_SERIES[granularity]
    const next = [...this.rollingPoints, point]
    this.rollingPoints = next.slice(Math.max(0, next.length - max))
  }
}
