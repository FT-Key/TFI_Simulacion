package com.example.backend.model;

import com.example.backend.model.dto.DailySeriesPointDto;
import com.example.backend.model.dto.DeviceEventDto;
import com.example.backend.model.dto.SimulationConfigDto;
import lombok.Getter;
import lombok.Setter;

import java.util.*;

/**
 * Estado completo de una corrida de simulación.
 * Una instancia por corrida, accedida por un único hilo scheduled.
 *
 * Escala temporal: 1 tick = 1 día calendario.
 *   Año simulado: 365 días (días 1-365).
 *   Días hábiles: lunes-viernes (dayOfWeek ∈ {1,2,3,4,5}).
 *   Jornada laboral: 8:00-17:00 = 9 horas útiles.
 */
@Getter
@Setter
public class SimulationState {

    private final String             runId;
    private final SimulationConfigDto config;
    private final LcgGenerator        rng;

    // ── Reloj de simulación ────────────────────────────────────────────────────
    private int     currentDay;    // 1 … 365 (o 730 para 2 años)
    private int     currentMonth;  // 1-12
    private int     dayOfWeek;     // 1=Lunes … 7=Domingo
    private boolean peakMonth;     // ene(1), jun(6), jul(7), dic(12)
    private boolean workDay;       // dayOfWeek ≤ 5
    private boolean completed;

    // ── Suspensión de recepción ────────────────────────────────────────────────
    private boolean suspended;
    private int     suspensionDaysRemaining;
    private int     totalSuspensions;

    // ── Cola de desensamblaje ─────────────────────────────────────────────────
    private final Queue<Device> disassemblyQueue;

    // ── Estaciones de trabajo ─────────────────────────────────────────────────
    private final List<StationState> stations;

    // ── Métricas del día (se resetean en cada tick) ────────────────────────────
    private int    dailyArrivals;
    private int    dailyCaseA;
    private int    dailyTerminalWaste;
    private int    dailyCaseB;
    private int    dailyDisassembled;
    private double dailyCaseARevenue;
    private double dailyMaterialRevenue;
    private double dailyLaborCost;
    private double dailySuspensionCost;
    private double dailyNetProfit;

    // ── Contadores acumulados ─────────────────────────────────────────────────
    private int totalArrived;
    private int totalCaseA;
    private int totalTerminalWaste;
    private int totalCaseB;
    private int totalDisassembled;

    // ── Economía acumulada (ARS) ───────────────────────────────────────────────
    private double totalCaseARevenue;
    private double totalMaterialRevenue;
    private double totalLaborCost;
    private double totalOpportunityCost;
    private double totalLogisticCost;
    private double totalNetProfit;

    // ── Materiales recuperados kg (por categoría) ─────────────────────────────
    private final Map<String, Double> materialRecoveredKg;

    // ── Serie histórica (un punto por día) ────────────────────────────────────
    private final List<DailySeriesPointDto> dailySeries;

    // ── Eventos individuales del día actual (se resetean cada tick) ───────────
    private final List<DeviceEventDto> todayEvents = new ArrayList<>();
    private int eventSeq = 0;

    // ─────────────────────────────────────────────────────────────────────────

    public SimulationState(String runId, SimulationConfigDto config) {
        this.runId  = runId;
        this.config = config;
        this.rng    = new LcgGenerator(System.currentTimeMillis());

        this.currentDay   = 0;
        this.currentMonth = 1;
        this.dayOfWeek    = 0;
        this.completed    = false;

        this.suspended                = false;
        this.suspensionDaysRemaining  = 0;
        this.totalSuspensions         = 0;

        this.disassemblyQueue = new LinkedList<>();

        this.stations = new ArrayList<>();
        int n = Math.max(1, config.getActiveStations());
        int ops = Math.max(1, config.getOperatorsPerStation());
        for (int i = 1; i <= n; i++) {
            stations.add(new StationState(i, ops));
        }

        this.materialRecoveredKg = new LinkedHashMap<>();
        this.materialRecoveredKg.put("plastico",  0.0);
        this.materialRecoveredKg.put("ferroso",   0.0);
        this.materialRecoveredKg.put("preciosos", 0.0);
        this.materialRecoveredKg.put("aluminio",  0.0);
        this.materialRecoveredKg.put("cobre",     0.0);

        this.dailySeries = new ArrayList<>();
    }

    public void addMaterialKg(String category, double kg) {
        materialRecoveredKg.merge(category, kg, Double::sum);
    }

    /** Avanza el reloj un día calendario y actualiza todos los campos derivados. */
    public void advanceDay() {
        currentDay++;
        dayOfWeek    = ((currentDay - 1) % 7) + 1;  // 1=Lunes, 7=Domingo
        workDay      = dayOfWeek <= 5;
        currentMonth = dayOfYearToMonth(currentDay);
        peakMonth    = (currentMonth == 1 || currentMonth == 6
                     || currentMonth == 7 || currentMonth == 12);

        int years = config.getSimulationDurationYears() > 0 ? config.getSimulationDurationYears() : 1;
        completed = currentDay > years * 365;
    }

    /** Resetea las métricas diarias antes de procesar el tick. */
    public void resetDailyMetrics() {
        dailyArrivals       = 0;
        dailyCaseA          = 0;
        dailyTerminalWaste  = 0;
        dailyCaseB          = 0;
        dailyDisassembled   = 0;
        dailyCaseARevenue   = 0.0;
        dailyMaterialRevenue = 0.0;
        dailyLaborCost      = 0.0;
        dailySuspensionCost = 0.0;
        dailyNetProfit      = 0.0;
        todayEvents.clear();
        eventSeq = 0;
    }

    public int nextEventSeq() { return ++eventSeq; }

    // Acumulado de días por mes (año no bisiesto)
    private static final int[] MONTH_END_DAY = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365};

    private static int dayOfYearToMonth(int day) {
        for (int m = 1; m <= 12; m++) {
            if (day <= MONTH_END_DAY[m]) return m;
        }
        return 12;
    }
}
