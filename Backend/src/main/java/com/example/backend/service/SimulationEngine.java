package com.example.backend.service;

import com.example.backend.model.*;
import com.example.backend.model.dto.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Motor discreto día por día – Planta EMA S.R.L.
 *
 * Escala temporal
 *   1 tick = 1 día calendario | 365 ticks = 1 año simulado
 *   Jornada hábil: lunes-viernes, 8:00-17:00 (9 horas útiles)
 *
 * Flujo de cada día hábil normal
 *   1. Llegadas  → U[35,45] normales | U[50,70] meses pico (ene,jun,jul,dic)
 *   2. Triaje    → 15% Caso A (reventa) | 8.5% residuo terminal | 76.5% Caso B (desguace)
 *   3. Chequeo suspensión: cola ≥ 250 → clausura de 7 días calendario
 *   4. Desensamblaje multicanal en paralelo (N estaciones × M ops × 540 min)
 *   5. Recuperación de materiales (precios ARS)
 *   6. Costos laborales: (ops_triaje + N×M) × 9 h × $3 500/h
 *
 * Suspensión (7 días calendario)
 *   - Sin llegadas ni triaje
 *   - Estaciones trabajan a máxima capacidad en días hábiles
 *   - Costo de oportunidad diario: U[$2 800 000, $4 200 000]
 *   - Cargo fijo al finalizar: $350 000
 */
@Slf4j
@Service
public class SimulationEngine {

    // ── Precios de materiales (ARS/kg) ────────────────────────────────────────
    private static final double PRICE_PLASTICO  =  800.0;
    private static final double PRICE_FERROSO   =  400.0;
    private static final double PRICE_PRECIOSOS = 4_500.0;
    private static final double PRICE_ALUMINIO  = 1_800.0;
    private static final double PRICE_COBRE     = 6_200.0;
    private static final double COST_PELIGROSO  = 1_200.0;  // costo por kg (se resta)

    // ── Parámetros de cola y suspensión ───────────────────────────────────────
    private static final int    MAX_QUEUE              = 250;
    private static final int    SUSPENSION_DAYS        = 7;
    private static final double SUSPENSION_FIXED_COST  = 350_000.0;  // ARS al fin de la semana

    // ── Laborales ─────────────────────────────────────────────────────────────
    private static final double HOURLY_WAGE             = 3_500.0;  // ARS/hora/operario
    private static final int    WORK_HOURS              = 9;
    private static final int    WORK_MINUTES_PER_OP_DAY = WORK_HOURS * 60;  // 540 min

    // ─────────────────────────────────────────────────────────────────────────
    //  Punto de entrada
    // ─────────────────────────────────────────────────────────────────────────

    public PlantSnapshotDto processTick(SimulationState state) {
        state.advanceDay();
        state.resetDailyMetrics();

        if (state.isCompleted()) {
            log.info("╔══════ SIMULACIÓN COMPLETADA – Día {} ══════╗", state.getCurrentDay() - 1);
            return buildSnapshot(state);
        }

        log.info("╔══ DÍA {} │ Mes {} │ {} │ {} {} ══╗",
                state.getCurrentDay(), state.getCurrentMonth(),
                dayLabel(state.getDayOfWeek()),
                state.isSuspended() ? "[SUSPENDIDO]" : "[ACTIVO]",
                state.isPeakMonth() ? "[PICO]" : "");

        if (state.isSuspended()) {
            processSuspensionDay(state);
        } else if (state.isWorkDay()) {
            processWorkDay(state);
        } else {
            log.info("  Fin de semana – sin actividad.");
        }

        recalcTotals(state);
        appendDailySeries(state);

        log.info("╚══ Net hoy: ${} | Acumulado: ${} | Cola: {} ══╝",
                (long) state.getDailyNetProfit(), (long) state.getTotalNetProfit(),
                state.getDisassemblyQueue().size());

        return buildSnapshot(state);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Día durante suspensión
    // ─────────────────────────────────────────────────────────────────────────

    private void processSuspensionDay(SimulationState state) {
        double opp = state.getRng().nextUniform(2_800_000, 4_200_000);
        state.setDailySuspensionCost(opp);
        state.setTotalOpportunityCost(state.getTotalOpportunityCost() + opp);
        log.warn("  CLAUSURA │ días restantes: {} │ costo oportunidad: ${}",
                state.getSuspensionDaysRemaining(), (long) opp);

        // Los días hábiles las estaciones trabajan para evacuar la cola
        if (state.isWorkDay()) {
            double matRev = processDisassemblyQueue(state);
            state.setDailyMaterialRevenue(matRev);
            state.setTotalMaterialRevenue(state.getTotalMaterialRevenue() + matRev);

            double labor = calculateLaborCost(state);
            state.setDailyLaborCost(labor);
            state.setTotalLaborCost(state.getTotalLaborCost() + labor);
        }

        state.setSuspensionDaysRemaining(state.getSuspensionDaysRemaining() - 1);

        if (state.getSuspensionDaysRemaining() == 0) {
            state.setTotalLogisticCost(state.getTotalLogisticCost() + SUSPENSION_FIXED_COST);
            state.setSuspended(false);
            state.setTotalSuspensions(state.getTotalSuspensions() + 1);
            log.info("  ✔ Suspensión finalizada. Cargo logístico: ${}. Suspensiones totales: {}",
                    (long) SUSPENSION_FIXED_COST, state.getTotalSuspensions());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Día hábil normal
    // ─────────────────────────────────────────────────────────────────────────

    private void processWorkDay(SimulationState state) {
        // 1. Llegadas
        int n = generateArrivals(state);
        state.setDailyArrivals(n);
        state.setTotalArrived(state.getTotalArrived() + n);
        log.info("  Llegadas: {} equipos {}", n, state.isPeakMonth() ? "[mes pico]" : "[mes normal]");

        // 2. Triaje
        classifyArrivals(state, n);

        // 3. Chequeo de cola → posible suspensión
        if (!state.isSuspended() && state.getDisassemblyQueue().size() >= MAX_QUEUE) {
            state.setSuspended(true);
            state.setSuspensionDaysRemaining(SUSPENSION_DAYS);
            log.warn("  !! COLA SATURADA: {} ≥ {} → SUSPENSIÓN de {} días activada",
                    state.getDisassemblyQueue().size(), MAX_QUEUE, SUSPENSION_DAYS);
        }

        // 4. Desensamblaje (siempre, incluso si acaba de activarse la suspensión)
        double matRev = processDisassemblyQueue(state);
        state.setDailyMaterialRevenue(matRev);
        state.setTotalMaterialRevenue(state.getTotalMaterialRevenue() + matRev);

        // 5. Costos laborales
        double labor = calculateLaborCost(state);
        state.setDailyLaborCost(labor);
        state.setTotalLaborCost(state.getTotalLaborCost() + labor);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Llegadas
    // ─────────────────────────────────────────────────────────────────────────

    private int generateArrivals(SimulationState state) {
        LcgGenerator rng = state.getRng();
        if (state.isPeakMonth()) {
            return (int) Math.round(rng.nextUniform(50, 70));
        } else {
            return (int) Math.round(rng.nextUniform(35, 45));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Triaje y clasificación
    // ─────────────────────────────────────────────────────────────────────────

    private void classifyArrivals(SimulationState state, int n) {
        LcgGenerator rng = state.getRng();
        int caseA = 0, terminal = 0, caseB = 0;
        double caseARevenue = 0;

        for (int i = 0; i < n; i++) {
            double r = rng.next();
            if (r < 0.15) {
                // Caso A: equipo funcional con antigüedad < 7 años
                double rev = rng.nextUniform(120_000, 180_000);
                caseARevenue += rev;
                caseA++;
                state.getTodayEvents().add(DeviceEventDto.builder()
                        .seq(state.nextEventSeq())
                        .eventType("TRIAGE")
                        .triageResult("CASO_A")
                        .caseARevenue(rev)
                        .build());
            } else {
                // 85% inoperable
                double r2 = rng.next();
                if (r2 < 0.10) {
                    // 10% del inoperable → destrucción total / exposición química
                    terminal++;
                    state.getTodayEvents().add(DeviceEventDto.builder()
                            .seq(state.nextEventSeq())
                            .eventType("TRIAGE")
                            .triageResult("TERMINAL")
                            .build());
                } else {
                    // 90% del inoperable → Caso B: módulos internos preservados
                    Device device = generateDevice(rng);
                    state.getDisassemblyQueue().add(device);
                    caseB++;
                    state.getTodayEvents().add(DeviceEventDto.builder()
                            .seq(state.nextEventSeq())
                            .eventType("TRIAGE")
                            .triageResult("CASO_B")
                            .deviceType(device.getType().name())
                            .weightKg(device.getWeightKg())
                            .processingTimeMinutes(device.getProcessingTimeMinutes())
                            .build());
                }
            }
        }

        state.setDailyCaseA(caseA);
        state.setDailyTerminalWaste(terminal);
        state.setDailyCaseB(caseB);
        state.setDailyCaseARevenue(caseARevenue);
        state.setTotalCaseA(state.getTotalCaseA() + caseA);
        state.setTotalTerminalWaste(state.getTotalTerminalWaste() + terminal);
        state.setTotalCaseB(state.getTotalCaseB() + caseB);
        state.setTotalCaseARevenue(state.getTotalCaseARevenue() + caseARevenue);

        log.info("  Triaje → CasoA: {} (${}). Terminal: {}. CasoB→cola: {}. Cola total: {}",
                caseA, (long) caseARevenue, terminal, caseB, state.getDisassemblyQueue().size());
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Desensamblaje multicanal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Procesamiento multicanal: cada estación tiene su propio presupuesto de minutos.
     * Si la estación 1 no puede procesar el próximo dispositivo (FIFO), la estación 2
     * puede tomarlo con su presupuesto completo. Esto modela correctamente el modelo
     * de colas M/G/c con disciplina FIFO y c canales en paralelo.
     */
    private double processDisassemblyQueue(SimulationState state) {
        state.getStations().forEach(StationState::resetDaily);

        int    opsPerSt      = Math.max(1, state.getConfig().getOperatorsPerStation());
        double stationCapMin = (double) opsPerSt * WORK_MINUTES_PER_OP_DAY;  // min/estación

        double materialRevenue = 0;
        int    processed       = 0;

        for (StationState station : state.getStations()) {
            if (state.getDisassemblyQueue().isEmpty()) break;

            double remaining = stationCapMin;

            while (!state.getDisassemblyQueue().isEmpty()) {
                Device next = state.getDisassemblyQueue().peek();
                if (remaining < next.getProcessingTimeMinutes()) break;  // no cabe en esta estación

                state.getDisassemblyQueue().poll();
                remaining -= next.getProcessingTimeMinutes();
                station.recordDeviceProcessed(next.getProcessingTimeMinutes());

                double value = recoverMaterialValue(next, state);
                materialRevenue += value;
                processed++;
                state.setTotalDisassembled(state.getTotalDisassembled() + 1);
            }
        }

        state.setDailyDisassembled(processed);

        if (processed > 0) {
            log.info("  Desguace → {} dispositivos. Ingresos: ${}. Cola restante: {}",
                    processed, (long) materialRevenue, state.getDisassemblyQueue().size());
        } else {
            log.info("  Desguace → sin capacidad o cola vacía. Cola: {}",
                    state.getDisassemblyQueue().size());
        }
        return materialRevenue;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Generación de dispositivo Caso B
    // ─────────────────────────────────────────────────────────────────────────

    private Device generateDevice(LcgGenerator rng) {
        DeviceType type     = selectType(rng);
        double     weight   = generateWeight(type, rng);
        double     procTime = generateProcessingTime(type, rng);
        return Device.builder()
                .type(type)
                .weightKg(weight)
                .processingTimeMinutes(procTime)
                .outcome(DeviceOutcome.DISASSEMBLY)
                .build();
    }

    private DeviceType selectType(LcgGenerator rng) {
        double u = rng.next();
        if (u < 0.30) return DeviceType.INKJET;      // 30% hogareñas livianas
        if (u < 0.80) return DeviceType.LASER;       // 50% láser de oficina
        return DeviceType.INDUSTRIAL;                 // 20% industriales pesadas
    }

    private double generateWeight(DeviceType type, LcgGenerator rng) {
        return switch (type) {
            case INKJET     -> rng.nextUniform(4,  6);   // kg
            case LASER      -> rng.nextUniform(12, 18);  // kg
            case INDUSTRIAL -> rng.nextUniform(45, 70);  // kg
        };
    }

    private double generateProcessingTime(DeviceType type, LcgGenerator rng) {
        return switch (type) {
            case INKJET     -> rng.nextUniform(39, 59);           // U[39,59] min
            case LASER      -> Math.max(30, rng.nextNormal(55, 4.5)); // N(55,4.5) min
            case INDUSTRIAL -> rng.nextUniform(60, 83);           // U[60,83] min
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Recuperación de materiales (ARS)
    // ─────────────────────────────────────────────────────────────────────────

    private double recoverMaterialValue(Device device, SimulationState state) {
        LcgGenerator rng    = state.getRng();
        double       weight = device.getWeightKg();

        // Fracciones según el modelo verbal
        double plasticKg   = weight * rng.nextUniform(0.40, 0.50);
        double ferrousKg   = weight * rng.nextUniform(0.25, 0.30);
        double preciousKg  = weight * rng.nextUniform(0.05, 0.10);
        double aluminumKg  = weight * 0.02;  // fijo 2%
        double copperKg    = weight * 0.02;  // fijo 2%
        double hazardousKg = weight * 0.05;  // fijo 5% (costo)

        state.addMaterialKg("plastico",  plasticKg);
        state.addMaterialKg("ferroso",   ferrousKg);
        state.addMaterialKg("preciosos", preciousKg);
        state.addMaterialKg("aluminio",  aluminumKg);
        state.addMaterialKg("cobre",     copperKg);

        double value = plasticKg   * PRICE_PLASTICO
                     + ferrousKg   * PRICE_FERROSO
                     + preciousKg  * PRICE_PRECIOSOS
                     + aluminumKg  * PRICE_ALUMINIO
                     + copperKg    * PRICE_COBRE
                     - hazardousKg * COST_PELIGROSO;

        // Evento individual para replay en el frontend
        state.getTodayEvents().add(DeviceEventDto.builder()
                .seq(state.nextEventSeq())
                .eventType("DESGUACE")
                .deviceType(device.getType().name())
                .weightKg(weight)
                .processingTimeMinutes(device.getProcessingTimeMinutes())
                .materialRevenue(value)
                .plasticKg(plasticKg)
                .ferrousKg(ferrousKg)
                .preciousKg(preciousKg)
                .aluminumKg(aluminumKg)
                .copperKg(copperKg)
                .build());

        return value;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Costos laborales
    // ─────────────────────────────────────────────────────────────────────────

    private double calculateLaborCost(SimulationState state) {
        int triageOps = Math.max(1, state.getConfig().getTriageOperators());
        int disassOps = state.getStations().size() * Math.max(1, state.getConfig().getOperatorsPerStation());
        return (triageOps + disassOps) * WORK_HOURS * HOURLY_WAGE;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Cálculo de totales acumulados
    // ─────────────────────────────────────────────────────────────────────────

    private void recalcTotals(SimulationState state) {
        double totalRevenue = state.getTotalCaseARevenue() + state.getTotalMaterialRevenue();
        double totalCost    = state.getTotalLaborCost()
                            + state.getTotalOpportunityCost()
                            + state.getTotalLogisticCost();
        state.setTotalNetProfit(totalRevenue - totalCost);

        double dayRevenue = state.getDailyCaseARevenue() + state.getDailyMaterialRevenue();
        double dayCost    = state.getDailyLaborCost() + state.getDailySuspensionCost();
        state.setDailyNetProfit(dayRevenue - dayCost);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Serie histórica diaria
    // ─────────────────────────────────────────────────────────────────────────

    private void appendDailySeries(SimulationState state) {
        double dayRev  = state.getDailyCaseARevenue() + state.getDailyMaterialRevenue();
        double dayCost = state.getDailyLaborCost() + state.getDailySuspensionCost();

        DailySeriesPointDto point = DailySeriesPointDto.builder()
                .day(state.getCurrentDay())
                .label(String.format("D%03d", state.getCurrentDay()))
                .month(state.getCurrentMonth())
                .workDay(state.isWorkDay())
                .suspended(state.isSuspended() || state.getSuspensionDaysRemaining() > 0)
                .arrivals(state.getDailyArrivals())
                .caseA(state.getDailyCaseA())
                .terminalWaste(state.getDailyTerminalWaste())
                .caseB(state.getDailyCaseB())
                .disassembled(state.getDailyDisassembled())
                .queueSize(state.getDisassemblyQueue().size())
                .dailyRevenue(dayRev)
                .dailyCost(dayCost)
                .dailyNetProfit(state.getDailyNetProfit())
                .build();

        state.getDailySeries().add(point);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Construcción del snapshot
    // ─────────────────────────────────────────────────────────────────────────

    public PlantSnapshotDto buildSnapshot(SimulationState state) {
        int total = state.getTotalArrived();

        KpiSnapshotDto kpis = KpiSnapshotDto.builder()
                .caseAPct(           total > 0 ? (double) state.getTotalCaseA()         / total * 100 : 0)
                .terminalWastePct(   total > 0 ? (double) state.getTotalTerminalWaste()  / total * 100 : 0)
                .disassemblyPct(     total > 0 ? (double) state.getTotalDisassembled()   / total * 100 : 0)
                .queueUtilizationPct(state.getDisassemblyQueue().size() / (double) MAX_QUEUE * 100)
                .stationUtilizationPct(avgStationUtilization(state))
                .build();

        List<StationSnapshotDto> stationDtos = state.getStations().stream()
                .map(s -> StationSnapshotDto.builder()
                        .id(s.getId())
                        .operatorsAssigned(s.getOperatorsAssigned())
                        .dailyCompleted(s.getDailyCompleted())
                        .totalCompletedDevices(s.getTotalCompletedDevices())
                        .utilizationPct(s.getUtilizationPct())
                        .build())
                .toList();

        return PlantSnapshotDto.builder()
                // Reloj
                .tick(state.getCurrentDay())
                .currentDay(state.getCurrentDay())
                .currentMonth(state.getCurrentMonth())
                .dayOfWeek(state.getDayOfWeek())
                .peakMonth(state.isPeakMonth())
                .workDay(state.isWorkDay())
                .completed(state.isCompleted())
                // Cola / suspensión
                .queueSize(state.getDisassemblyQueue().size())
                .suspended(state.isSuspended())
                .suspensionDaysRemaining(state.getSuspensionDaysRemaining())
                .totalSuspensions(state.getTotalSuspensions())
                // Métricas del día
                .dailyArrivals(state.getDailyArrivals())
                .dailyCaseA(state.getDailyCaseA())
                .dailyTerminalWaste(state.getDailyTerminalWaste())
                .dailyCaseB(state.getDailyCaseB())
                .dailyDisassembled(state.getDailyDisassembled())
                .dailyCaseARevenue(state.getDailyCaseARevenue())
                .dailyMaterialRevenue(state.getDailyMaterialRevenue())
                .dailyLaborCost(state.getDailyLaborCost())
                .dailySuspensionCost(state.getDailySuspensionCost())
                .dailyNetProfit(state.getDailyNetProfit())
                // Acumulados
                .totalArrived(state.getTotalArrived())
                .totalCaseA(state.getTotalCaseA())
                .totalTerminalWaste(state.getTotalTerminalWaste())
                .totalDisassembled(state.getTotalDisassembled())
                .totalCaseARevenue(state.getTotalCaseARevenue())
                .totalMaterialRevenue(state.getTotalMaterialRevenue())
                .totalLaborCost(state.getTotalLaborCost())
                .totalOpportunityCost(state.getTotalOpportunityCost())
                .totalLogisticCost(state.getTotalLogisticCost())
                .totalNetProfit(state.getTotalNetProfit())
                // KPIs y detalles
                .kpis(kpis)
                .stations(stationDtos)
                .materialRecoveredKg(new LinkedHashMap<>(state.getMaterialRecoveredKg()))
                .dailySeries(new ArrayList<>(state.getDailySeries()))
                .deviceEvents(new ArrayList<>(state.getTodayEvents()))
                .build();
    }

    private double avgStationUtilization(SimulationState state) {
        return state.getStations().stream()
                .mapToDouble(StationState::getUtilizationPct)
                .average()
                .orElse(0.0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers de log
    // ─────────────────────────────────────────────────────────────────────────

    private static String dayLabel(int dow) {
        return switch (dow) {
            case 1 -> "Lunes";
            case 2 -> "Martes";
            case 3 -> "Miércoles";
            case 4 -> "Jueves";
            case 5 -> "Viernes";
            case 6 -> "Sábado";
            case 7 -> "Domingo";
            default -> "?";
        };
    }
}
