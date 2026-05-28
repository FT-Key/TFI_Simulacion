export type SimulationDurationYears = 1 | 2

export interface SimulationConfig {
  triageOperators: number
  activeStations: number
  operatorsPerStation: number
  /** ms reales entre ticks (1 tick = 1 día simulado). */
  tickMs: number
  simulationDurationYears: SimulationDurationYears
}

// ── Snapshot por tick ──────────────────────────────────────────────────────────

export interface StationSnapshot {
  id: number
  operatorsAssigned: number
  dailyCompleted: number
  totalCompletedDevices: number
  utilizationPct: number
}

export interface KpiSnapshot {
  caseAPct: number
  terminalWastePct: number
  disassemblyPct: number
  queueUtilizationPct: number
  stationUtilizationPct: number
}

export interface DailySeriesPoint {
  day: number
  label: string
  month: number
  workDay: boolean
  suspended: boolean
  arrivals: number
  caseA: number
  terminalWaste: number
  caseB: number
  disassembled: number
  queueSize: number
  dailyRevenue: number
  dailyCost: number
  dailyNetProfit: number
}

/** Evento atómico de un dispositivo (triaje o desguace). */
export interface DeviceEvent {
  seq: number
  eventType: 'TRIAGE' | 'DESGUACE'

  // Datos del equipo
  deviceType?: 'INKJET' | 'LASER' | 'INDUSTRIAL'
  weightKg?: number
  processingTimeMinutes?: number

  // Triaje
  triageResult?: 'CASO_A' | 'TERMINAL' | 'CASO_B'
  caseARevenue?: number

  // Desguace
  materialRevenue?: number
  plasticKg?: number
  ferrousKg?: number
  preciousKg?: number
  aluminumKg?: number
  copperKg?: number

  /**
   * Campos calculados en el frontend (no vienen del backend).
   * simTimeMinutes: minutos desde medianoche en tiempo simulado cuando ocurre el evento
   *   (para TRIAGE: cuando se clasifica; para DESGUACE: cuando termina el desarmado)
   * dayNumber: día de simulación al que pertenece este evento
   */
  simTimeMinutes?: number
  dayNumber?: number
}

export interface PlantSnapshot {
  // Reloj
  tick: number
  currentDay: number
  currentMonth: number
  dayOfWeek: number
  peakMonth: boolean
  workDay: boolean
  isCompleted: boolean

  // Cola / suspensión
  queueSize: number
  suspended: boolean
  suspensionDaysRemaining: number
  totalSuspensions: number

  // Métricas del día
  dailyArrivals: number
  dailyCaseA: number
  dailyTerminalWaste: number
  dailyCaseB: number
  dailyDisassembled: number
  dailyCaseARevenue: number
  dailyMaterialRevenue: number
  dailyLaborCost: number
  dailySuspensionCost: number
  dailyNetProfit: number

  // Acumulados
  totalArrived: number
  totalCaseA: number
  totalTerminalWaste: number
  totalDisassembled: number
  totalCaseARevenue: number
  totalMaterialRevenue: number
  totalLaborCost: number
  totalOpportunityCost: number
  totalLogisticCost: number
  totalNetProfit: number

  kpis: KpiSnapshot
  stations: StationSnapshot[]
  materialRecoveredKg: Record<string, number>
  dailySeries: DailySeriesPoint[]

  /** Eventos individuales del día, para replay uno a uno en el frontend. */
  deviceEvents: DeviceEvent[]
}
