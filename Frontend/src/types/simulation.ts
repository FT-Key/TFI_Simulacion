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
   * TRIAGE / DESGUACE / SUSPENSION_DAY / SUSPENSION_END: vienen del backend.
   * ARRIVALS: sintético — anuncia cuántos dispositivos ingresaron al día.
   * DAY_END:  sintético — cierre de jornada, dispara la pausa entre días.
   */
  eventType: 'TRIAGE' | 'DESGUACE' | 'ARRIVALS' | 'DAY_END' | 'SUSPENSION_DAY' | 'SUSPENSION_END'

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
   *   (para TRIAGE: cuando termina la clasificación; para DESGUACE: cuando termina el desarmado)
   * dayNumber: día de simulación al que pertenece este evento
   * arrivalsCount: sólo para eventType='ARRIVALS', cantidad de dispositivos que ingresaron
   */
  simTimeMinutes?: number
  dayNumber?: number
  arrivalsCount?: number
  /** true = día laborable (L-V y no feriado), false = fin de semana / feriado */
  workDay?: boolean
  /** Nombre del feriado nacional si aplica, undefined si es día normal o fin de semana */
  holidayName?: string
  /** true si el día es de clausura (planta suspendida). Solo en sentinel ARRIVALS. */
  suspended?: boolean
  /** SUSPENSION_DAY: costo de oportunidad del día. SUSPENSION_END: cargo logístico $350 000. */
  suspensionPenalty?: number
  /** SUSPENSION_DAY: días de clausura restantes antes de este día (7 el primero, 1 el último). */
  suspensionDaysLeft?: number
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
