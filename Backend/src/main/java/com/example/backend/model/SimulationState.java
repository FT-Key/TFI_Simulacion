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

    // ── Feriados nacionales argentinos (día del año, inamovibles) ────────────────
    private static final Map<Integer, String> HOLIDAYS = new LinkedHashMap<>();
    static {
        HOLIDAYS.put(  1, "Año Nuevo");
        HOLIDAYS.put( 83, "Día Nac. de la Memoria por la Verdad y la Justicia");  // 24 Mar
        HOLIDAYS.put( 92, "Veteranos y Caídos en la Guerra de Malvinas");          // 2 Abr
        HOLIDAYS.put(121, "Día Internacional del Trabajador");                     // 1 May
        HOLIDAYS.put(145, "Día de la Revolución de Mayo");                         // 25 May
        HOLIDAYS.put(168, "Paso a la Inmortalidad del Gral. Güemes");             // 17 Jun
        HOLIDAYS.put(171, "Paso a la Inmortalidad del Gral. Belgrano");           // 20 Jun
        HOLIDAYS.put(190, "Día de la Independencia");                              // 9 Jul
        HOLIDAYS.put(229, "Paso a la Inmortalidad del Gral. San Martín");         // 17 Ago
        HOLIDAYS.put(285, "Día del Respeto a la Diversidad Cultural");            // 12 Oct
        HOLIDAYS.put(324, "Día de la Soberanía Nacional");                        // 20 Nov
        HOLIDAYS.put(342, "Inmaculada Concepción de María");                      // 8 Dic
        HOLIDAYS.put(359, "Navidad");                                              // 25 Dic
    }

    // ── Reloj de simulación ────────────────────────────────────────────────────
    private int     currentDay;    // 1 … 365 (o 730 para 2 años)
    private int     currentMonth;  // 1-12
    private int     dayOfMonth;    // 1-31 dentro del mes
    private int     dayOfWeek;     // 1=Lunes … 7=Domingo
    private boolean peakMonth;     // ene(1), jun(6), jul(7), dic(12)
    private boolean workDay;       // lunes-viernes Y no es feriado nacional
    private String  holidayName;   // nombre del feriado, null si es día normal
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
        // Offset +3: día 1 = Jueves (1 Enero 2026). Sin offset sería Lunes.
        dayOfWeek    = ((currentDay - 1 + 3) % 7) + 1;  // 1=Lunes … 7=Domingo
        currentMonth = dayOfYearToMonth(currentDay);
        dayOfMonth   = currentDay - MONTH_END_DAY[currentMonth - 1];  // 1-based dentro del mes
        peakMonth    = (currentMonth == 1 || currentMonth == 6
                     || currentMonth == 7 || currentMonth == 12);

        // Feriado: usar posición dentro del año (soporta corridas de 2 años)
        int dayInYear = ((currentDay - 1) % 365) + 1;
        holidayName  = HOLIDAYS.get(dayInYear);
        workDay      = dayOfWeek <= 5 && holidayName == null;

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
