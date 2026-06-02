export type SimulationDurationYears = 1 | 2

export interface MonthlySeriesPoint {
  month: number      // 1-12
  yearIndex: number  // 1 o 2 (para corridas de 2 años)
  label: string      // "Ene", "Feb A2", etc.
  workDays: number
  suspensionDays: number
  arrivals: number
  caseA: number
  terminalWaste: number
  caseB: number
  disassembled: number
  avgQueueSize: number
  revenue: number
  cost: number
  netProfit: number
}

/**
 * Informe final de la corrida.
 * source='run'      → construido del snapshot acumulado al terminar la animación (mismo run).
 * source='computed' → construido llamando al endpoint /compute (run nuevo, mismo config).
 */
export interface SimulationReport {
  source: 'run' | 'computed'
  config: SimulationConfig
  // Totales
  totalArrived: number
  totalCaseA: number
  totalTerminalWaste: number
  totalCaseB: number
  totalDisassembled: number
  totalSuspensions: number
  totalCaseARevenue: number
  totalMaterialRevenue: number
  totalLaborCost: number
  totalOpportunityCost: number
  totalLogisticCost: number
  totalNetProfit: number
  // Detalle
  materialRecoveredKg: Record<string, number>
  kpis: KpiSnapshot
  stations: StationSnapshot[]
  monthlySeries: MonthlySeriesPoint[]
  dailySeries: DailySeriesPoint[]
}

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
  /**
   * Tipos del backend: TRIAGE | DESGUACE | TRIAGE_SUMMARY | OPPORTUNITY_INFO | SUSPENSION_END
   * Tipos sintéticos del frontend: ARRIVALS | DAY_END
   */
  eventType:
    | 'TRIAGE' | 'DESGUACE'
    | 'TRIAGE_SUMMARY'
    | 'OPPORTUNITY_INFO' | 'SUSPENSION_END'
    | 'ARRIVALS' | 'DAY_END'

  // Datos del equipo (TRIAGE y DESGUACE)
  deviceType?: 'INKJET' | 'LASER' | 'INDUSTRIAL'
  weightKg?: number
  processingTimeMinutes?: number

  // Triaje individual
  triageResult?: 'CASO_A' | 'TERMINAL' | 'CASO_B'
  caseARevenue?: number

  // Resumen de triaje diario (TRIAGE_SUMMARY)
  triageNewArrivals?: number
  triagePendingFromYesterday?: number
  triageTotalToClassify?: number
  triageClassified?: number
  triageLeftover?: number

  // Desguace
  materialRevenue?: number
  plasticKg?: number
  ferrousKg?: number
  preciousKg?: number
  aluminumKg?: number
  copperKg?: number

  /**
   * Campos calculados en el frontend (no vienen del backend).
   * simTimeMinutes: minutos desde medianoche en tiempo simulado cuando ocurre el evento.
   * dayNumber: día de simulación al que pertenece este evento.
   * arrivalsCount: sólo para ARRIVALS, cantidad de dispositivos que ingresaron.
   */
  simTimeMinutes?: number
  dayNumber?: number
  arrivalsCount?: number
  /** true = día laborable (L-V y no feriado), false = fin de semana / feriado */
  workDay?: boolean
  /** Nombre del feriado nacional si aplica. */
  holidayName?: string
  /** true si el día es de clausura. Solo en sentinel ARRIVALS. */
  suspended?: boolean
  /** Día del mes (1-31). Solo en sentinel ARRIVALS. */
  dayOfMonth?: number
  /** Mes del año (1-12). Solo en sentinel ARRIVALS. */
  currentMonth?: number
  /**
   * OPPORTUNITY_INFO: ingreso potencial perdido por clausura (solo informativo, NO se resta).
   * SUSPENSION_END: cargo logístico fijo ($700 000) al finalizar la clausura.
   */
  opportunityAmount?: number
  suspensionPenalty?: number
  /** OPPORTUNITY_INFO: días de clausura restantes antes de este día (7 el primero, 1 el último). */
  suspensionDaysLeft?: number
  /**
   * TRIAGE CASO_B y su DESGUACE: número secuencial GLOBAL (no se reinicia entre días).
   * Permite identificar unívocamente cada dispositivo a lo largo de toda la simulación.
   */
  caseBNum?: number
  /** DESGUACE: índice global del operario asignado (0 = op0 estación0, 1 = op1 estación0, 2 = op0 estación1, …). */
  workerSlot?: number
  /**
   * Solo en eventos ARRIVALS de días laborables.
   * Mapea caseBNum → workerSlot para todos los dispositivos procesados hoy,
   * incluyendo carry-overs de días anteriores. Permite asignar slots a phantoms
   * al inicio de la jornada sin necesidad de anticipar eventos DESGUACE.
   */
  caseBSlotMap?: Record<number, number>
}

export interface SavedReport {
  id: string
  savedAt: string  // ISO string
  report: SimulationReport
}

export interface PlantSnapshot {
  // Reloj
  tick: number
  currentDay: number
  currentMonth: number
  dayOfMonth: number
  dayOfWeek: number
  peakMonth: boolean
  workDay: boolean
  holidayName?: string
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
  dailyOpportunityInfo: number  // ingreso potencial perdido por clausura (solo informativo)
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
