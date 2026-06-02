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
 *   2. Triaje    → Exp(7.5 min)/unidad | 15% Caso A | 8.5% residuo terminal | 76.5% Caso B
 *                  Dispositivos no alcanzados en la jornada → cola de triaje pendiente (día siguiente)
 *   3. Chequeo suspensión: cola desguace ≥ 250 → clausura de 7 días calendario
 *   4. Desensamblaje multicanal en paralelo (N estaciones × M ops × 540 min)
 *   5. Recuperación de materiales (precios ARS)
 *   6. Costos laborales: (ops_triaje + N×M) × 9 h × $3 500/h
 *
 * Suspensión (7 días calendario)
 *   - Sin llegadas ni triaje; cola de triaje pendiente se congela
 *   - Estaciones trabajan a máxima capacidad en días hábiles
 *   - Ingreso potencial diario: U[$2 800 000, $4 200 000] — solo informativo, NO se resta
 *   - Cargo fijo al finalizar: $700 000
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
    private static final int    MAX_QUEUE             = 250;
    private static final int    SUSPENSION_DAYS       = 7;
    private static final double SUSPENSION_FIXED_COST = 700_000.0;  // ARS al fin de la clausura

    // ── Laborales ─────────────────────────────────────────────────────────────
    private static final double HOURLY_WAGE             = 5_000.0;
    private static final int    WORK_HOURS              = 9;
    private static final int    WORK_MINUTES_PER_OP_DAY = WORK_HOURS * 60;  // 540 min

    // ── Triaje ────────────────────────────────────────────────────────────────
    private static final double TRIAGE_MEAN_MINUTES = 7.5;  // media de Exp(λ=1/7.5)

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

        // Chequeo de saturación al INICIO del día usando la cola del día anterior.
        // Así el día que se supera el límite opera normalmente (arrivals + triaje + desguace)
        // y la clausura comienza recién el día siguiente.
        if (!state.isSuspended() && state.getDisassemblyQueue().size() >= MAX_QUEUE) {
            state.setSuspended(true);
            state.setSuspensionDaysRemaining(SUSPENSION_DAYS);
            log.warn("  !! COLA SATURADA (arrastre del día anterior): {} ≥ {} → CLAUSURA de {} días activada",
                    state.getDisassemblyQueue().size(), MAX_QUEUE, SUSPENSION_DAYS);
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
        } else if (state.getHolidayName() != null) {
            log.info("  Feriado nacional: {} – sin actividad.", state.getHolidayName());
        } else {
            log.info("  Fin de semana – sin actividad.");
        }

        recalcTotals(state);
        appendDailySeries(state);

        log.info("╚══ Net hoy: ${} | Acumulado: ${} | Cola desguace: {} | Triaje pendiente: {} ══╝",
                (long) state.getDailyNetProfit(), (long) state.getTotalNetProfit(),
                state.getDisassemblyQueue().size(), state.getTriagePendingCount());

        return buildSnapshot(state);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Día durante suspensión
    // ─────────────────────────────────────────────────────────────────────────

    private void processSuspensionDay(SimulationState state) {
        if (state.isWorkDay()) {
            // Ingreso potencial que se dejó de percibir — SOLO informativo, no se resta
            double opp = state.getRng().nextUniform(2_800_000, 4_200_000);
            state.setDailyOpportunityInfo(opp);
            state.setTotalOpportunityCost(state.getTotalOpportunityCost() + opp);

            log.info("  CLAUSURA │ días restantes: {} │ ingreso potencial perdido: ${} (informativo)",
                    state.getSuspensionDaysRemaining(), (long) opp);

            // Evento informativo al inicio del día: lo que se habría ganado
            state.getTodayEvents().add(DeviceEventDto.builder()
                    .seq(state.nextEventSeq())
                    .eventType("OPPORTUNITY_INFO")
                    .opportunityAmount(opp)
                    .suspensionDaysLeft(state.getSuspensionDaysRemaining())
                    .build());

            // Las estaciones trabajan para evacuar la cola de desguace
            double matRev = processDisassemblyQueue(state);
            state.setDailyMaterialRevenue(matRev);
            state.setTotalMaterialRevenue(state.getTotalMaterialRevenue() + matRev);

            double labor = calculateLaborCost(state);
            state.setDailyLaborCost(labor);
            state.setTotalLaborCost(state.getTotalLaborCost() + labor);
        } else {
            log.info("  CLAUSURA (fin de semana) │ días restantes: {} │ sin actividad",
                    state.getSuspensionDaysRemaining());
        }

        state.setSuspensionDaysRemaining(state.getSuspensionDaysRemaining() - 1);

        if (state.getSuspensionDaysRemaining() == 0) {
            state.setTotalLogisticCost(state.getTotalLogisticCost() + SUSPENSION_FIXED_COST);
            state.setSuspended(false);
            state.setTotalSuspensions(state.getTotalSuspensions() + 1);
            log.info("  ✔ Suspensión finalizada. Cargo logístico: ${}. Suspensiones totales: {}",
                    (long) SUSPENSION_FIXED_COST, state.getTotalSuspensions());

            state.getTodayEvents().add(DeviceEventDto.builder()
                    .seq(state.nextEventSeq())
                    .eventType("SUSPENSION_END")
                    .suspensionPenalty(SUSPENSION_FIXED_COST)
                    .build());
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

        // 2. Triaje con cola pendiente y tiempo exponencial por unidad
        classifyArrivals(state, n);

        // 3. Desensamblaje
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
    //  Triaje y clasificación con backlog y tiempo Exp(7.5 min) por unidad
    // ─────────────────────────────────────────────────────────────────────────

    private void classifyArrivals(SimulationState state, int newArrivals) {
        LcgGenerator rng = state.getRng();

        int pendingFromYesterday = state.getTriagePendingCount();
        int totalToClassify      = newArrivals + pendingFromYesterday;

        // Capacidad de triaje: un operario de triaje × 540 min (o los configurados)
        int    triageOps       = Math.max(1, state.getConfig().getTriageOperators());
        double triageCapacity  = (double) triageOps * WORK_MINUTES_PER_OP_DAY;

        log.info("  Triaje │ Hoy ingresaron: {} │ Pendientes de ayer: {} │ Total a clasificar: {}",
                newArrivals, pendingFromYesterday, totalToClassify);

        int    caseA      = 0;
        int    terminal   = 0;
        int    caseB      = 0;
        double caseARevenue   = 0;
        double triageTimeUsed = 0;
        int    classified     = 0;

        for (int i = 0; i < totalToClassify; i++) {
            double triageTime = rng.nextExponential(TRIAGE_MEAN_MINUTES);
            if (triageTimeUsed + triageTime > triageCapacity) break;
            triageTimeUsed += triageTime;
            classified++;

            double r = rng.next();
            if (r < 0.15) {
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
                double r2 = rng.next();
                if (r2 < 0.10) {
                    terminal++;
                    state.getTodayEvents().add(DeviceEventDto.builder()
                            .seq(state.nextEventSeq())
                            .eventType("TRIAGE")
                            .triageResult("TERMINAL")
                            .build());
                } else {
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

        int leftover = totalToClassify - classified;
        state.setTriagePendingCount(leftover);

        // Evento resumen de triaje del día
        state.getTodayEvents().add(DeviceEventDto.builder()
                .seq(state.nextEventSeq())
                .eventType("TRIAGE_SUMMARY")
                .triageNewArrivals(newArrivals)
                .triagePendingFromYesterday(pendingFromYesterday)
                .triageTotalToClassify(totalToClassify)
                .triageClassified(classified)
                .triageLeftover(leftover)
                .build());

        state.setDailyCaseA(caseA);
        state.setDailyTerminalWaste(terminal);
        state.setDailyCaseB(caseB);
        state.setDailyCaseARevenue(caseARevenue);
        state.setTotalCaseA(state.getTotalCaseA() + caseA);
        state.setTotalTerminalWaste(state.getTotalTerminalWaste() + terminal);
        state.setTotalCaseB(state.getTotalCaseB() + caseB);
        state.setTotalCaseARevenue(state.getTotalCaseARevenue() + caseARevenue);

        if (leftover > 0) {
            log.info("  Triaje → CasoA: {} (${}). Terminal: {}. CasoB→cola: {}. Clasificados: {}/{}. ⚠ {} pendientes mañana.",
                    caseA, (long) caseARevenue, terminal, caseB, classified, totalToClassify, leftover);
        } else {
            log.info("  Triaje → CasoA: {} (${}). Terminal: {}. CasoB→cola: {}. Clasificados: {}/{} ✔",
                    caseA, (long) caseARevenue, terminal, caseB, classified, totalToClassify);
        }
        log.info("  Cola desguace total: {}", state.getDisassemblyQueue().size());
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Desensamblaje multicanal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Procesamiento multicanal con paralelismo real: todos los operarios de todas las
     * estaciones forman un pool plano. Cada dispositivo se asigna al operario que quede
     * libre más temprano y que aún pueda absorberlo dentro de su jornada (540 min).
     * De este modo las N estaciones × M operarios trabajan verdaderamente en paralelo.
     */
    private double processDisassemblyQueue(SimulationState state) {
        state.getStations().forEach(StationState::resetDaily);

        int      opsPerSt  = Math.max(1, state.getConfig().getOperatorsPerStation());
        int      totalOps  = state.getStations().size() * opsPerSt;
        double[] opUsed    = new double[totalOps];   // minutos acumulados por operario

        double materialRevenue = 0;
        int    processed       = 0;

        while (!state.getDisassemblyQueue().isEmpty()) {
            Device next     = state.getDisassemblyQueue().peek();
            double procTime = next.getProcessingTimeMinutes();

            // Operario más libre que todavía pueda absorber este dispositivo en la jornada
            int    bestOp   = -1;
            double bestUsed = Double.MAX_VALUE;
            for (int i = 0; i < totalOps; i++) {
                if (opUsed[i] + procTime <= WORK_MINUTES_PER_OP_DAY && opUsed[i] < bestUsed) {
                    bestUsed = opUsed[i];
                    bestOp   = i;
                }
            }
            if (bestOp < 0) break;   // ningún operario puede absorber el próximo dispositivo

            state.getDisassemblyQueue().poll();
            opUsed[bestOp] += procTime;

            int stIdx = bestOp / opsPerSt;
            state.getStations().get(stIdx).recordDeviceProcessed(procTime);

            double value = recoverMaterialValue(next, state);
            materialRevenue += value;
            processed++;
            state.setTotalDisassembled(state.getTotalDisassembled() + 1);
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
        if (u < 0.30) return DeviceType.INKJET;
        if (u < 0.80) return DeviceType.LASER;
        return DeviceType.INDUSTRIAL;
    }

    private double generateWeight(DeviceType type, LcgGenerator rng) {
        return switch (type) {
            case INKJET     -> rng.nextUniform(4,  6);
            case LASER      -> rng.nextUniform(12, 18);
            case INDUSTRIAL -> rng.nextUniform(45, 70);
        };
    }

    private double generateProcessingTime(DeviceType type, LcgGenerator rng) {
        return switch (type) {
            case INKJET     -> rng.nextUniform(39, 59);
            case LASER      -> Math.max(30, rng.nextNormal(55, 4.5));
            case INDUSTRIAL -> rng.nextUniform(60, 83);
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Recuperación de materiales (ARS)
    // ─────────────────────────────────────────────────────────────────────────

    private double recoverMaterialValue(Device device, SimulationState state) {
        LcgGenerator rng    = state.getRng();
        double       weight = device.getWeightKg();

        double plasticKg   = weight * rng.nextUniform(0.40, 0.50);
        double ferrousKg   = weight * rng.nextUniform(0.25, 0.30);
        double preciousKg  = weight * rng.nextUniform(0.05, 0.10);
        double aluminumKg  = weight * 0.02;
        double copperKg    = weight * 0.02;
        double hazardousKg = weight * 0.05;

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
        // Ingresos totales = reventa Caso A + materiales desguace
        double totalRevenue = state.getTotalCaseARevenue() + state.getTotalMaterialRevenue();
        // Costos reales = salarios + cargo logístico por suspensiones
        // totalOpportunityCost es informativo y NO se resta
        double totalCost = state.getTotalLaborCost() + state.getTotalLogisticCost();
        state.setTotalNetProfit(totalRevenue - totalCost);

        // Net del día = ingresos del día - costos del día (salarios)
        // dailyOpportunityInfo es informativo, NO se descuenta
        double dayRevenue = state.getDailyCaseARevenue() + state.getDailyMaterialRevenue();
        double dayCost    = state.getDailyLaborCost();
        state.setDailyNetProfit(dayRevenue - dayCost);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Serie histórica diaria
    // ─────────────────────────────────────────────────────────────────────────

    private void appendDailySeries(SimulationState state) {
        double dayRev  = state.getDailyCaseARevenue() + state.getDailyMaterialRevenue();
        double dayCost = state.getDailyLaborCost();  // solo salarios; oportunidad es informativa

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
                .dayOfMonth(state.getDayOfMonth())
                .dayOfWeek(state.getDayOfWeek())
                .peakMonth(state.isPeakMonth())
                .workDay(state.isWorkDay())
                .holidayName(state.getHolidayName())
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
                .dailyOpportunityInfo(state.getDailyOpportunityInfo())
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
