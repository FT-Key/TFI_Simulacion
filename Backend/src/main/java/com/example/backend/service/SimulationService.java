package com.example.backend.service;

import com.example.backend.model.SimulationState;
import com.example.backend.model.dto.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;

/**
 * Gestiona el ciclo de vida de las corridas de simulación.
 *
 * Cada corrida tiene su propio hilo scheduled que:
 *   1. Llama a SimulationEngine.processTick()
 *   2. Serializa el PlantSnapshot a JSON
 *   3. Lo envía a todos los SseEmitter suscriptos para esa corrida
 *   4. Detiene la corrida cuando isCompleted = true
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SimulationService {

    private final SimulationEngine engine;

    private final Map<String, SimulationState>          activeRuns      = new ConcurrentHashMap<>();
    private final Map<String, ScheduledFuture<?>>       scheduledRuns   = new ConcurrentHashMap<>();
    private final Map<String, Set<SseEmitter>>          emittersByRunId = new ConcurrentHashMap<>();
    /** IDs de corridas cuyo tick está suspendido (pausa). */
    private final Set<String>                           pausedRuns      = ConcurrentHashMap.newKeySet();

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(10);

    // ── Iniciar corrida ───────────────────────────────────────────────────

    public String startRun(SimulationConfigDto config) {
        String runId = UUID.randomUUID().toString();
        SimulationState state = new SimulationState(runId, config);
        activeRuns.put(runId, state);

        // Default: 1 620 000 ms = 27 min (9 horas × 3 min/hora simulada)
        long tickMs = config.getTickMs() > 0 ? config.getTickMs() : 1_620_000L;

        ScheduledFuture<?> future = scheduler.scheduleAtFixedRate(
                () -> tick(runId),
                500,         // delay inicial (da tiempo al cliente a suscribirse al SSE)
                tickMs,
                TimeUnit.MILLISECONDS
        );
        scheduledRuns.put(runId, future);

        log.info("Corrida iniciada: {} | dur={}a | tickMs={} | triaje={} | estaciones={} | ops/est={}",
                runId,
                config.getSimulationDurationYears(),
                tickMs,
                config.getTriageOperators(),
                config.getActiveStations(),
                config.getOperatorsPerStation());
        return runId;
    }

    // ── Detener corrida ───────────────────────────────────────────────────

    public void stopRun(String runId) {
        pausedRuns.remove(runId);
        ScheduledFuture<?> future = scheduledRuns.remove(runId);
        if (future != null) future.cancel(false);
        activeRuns.remove(runId);
        completeEmitters(runId);
        log.info("Corrida detenida: {}", runId);
    }

    // ── Pausar / reanudar corrida ─────────────────────────────────────────

    public void pauseRun(String runId) {
        if (activeRuns.containsKey(runId)) {
            pausedRuns.add(runId);
            log.info("Corrida pausada: {}", runId);
        }
    }

    public void resumeRun(String runId) {
        pausedRuns.remove(runId);
        log.info("Corrida reanudada: {}", runId);
    }

    public boolean isPaused(String runId) {
        return pausedRuns.contains(runId);
    }

    // ── Cómputo completo sin animación ────────────────────────────────────

    /**
     * Ejecuta toda la simulación en un loop sin delays y devuelve el informe completo.
     * Tiempo de cómputo típico: < 100 ms para 1 año, < 200 ms para 2 años.
     */
    public SimulationReportDto computeFullRun(SimulationConfigDto config) {
        long start = System.currentTimeMillis();

        SimulationState state = new SimulationState(UUID.randomUUID().toString(), config);
        PlantSnapshotDto last = null;
        while (!state.isCompleted()) {
            last = engine.processTick(state);
        }
        long elapsed = System.currentTimeMillis() - start;

        List<MonthlySeriesPointDto> monthly = buildMonthlySeries(state.getDailySeries());

        log.info("computeFullRun finalizado en {} ms | días={} | utilidad=${}",
                elapsed,
                state.getCurrentDay() - 1,
                (long) state.getTotalNetProfit());

        KpiSnapshotDto kpis     = last != null ? last.getKpis()     : null;
        List<StationSnapshotDto> stations = last != null ? last.getStations() : List.of();

        return SimulationReportDto.builder()
                .config(config)
                .computeTimeMs(elapsed)
                .totalArrived(state.getTotalArrived())
                .totalCaseA(state.getTotalCaseA())
                .totalTerminalWaste(state.getTotalTerminalWaste())
                .totalCaseB(state.getTotalCaseB())
                .totalDisassembled(state.getTotalDisassembled())
                .totalSuspensions(state.getTotalSuspensions())
                .totalCaseARevenue(state.getTotalCaseARevenue())
                .totalMaterialRevenue(state.getTotalMaterialRevenue())
                .totalLaborCost(state.getTotalLaborCost())
                .totalOpportunityCost(state.getTotalOpportunityCost())
                .totalLogisticCost(state.getTotalLogisticCost())
                .totalNetProfit(state.getTotalNetProfit())
                .materialRecoveredKg(new LinkedHashMap<>(state.getMaterialRecoveredKg()))
                .kpis(kpis)
                .stations(stations)
                .monthlySeries(monthly)
                .dailySeries(new ArrayList<>(state.getDailySeries()))
                .build();
    }

    private static final String[] MONTH_LABELS =
        { "", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic" };

    private List<MonthlySeriesPointDto> buildMonthlySeries(List<DailySeriesPointDto> daily) {
        // Agrupar días por mes
        Map<Integer, List<DailySeriesPointDto>> byMonth = new LinkedHashMap<>();
        for (int m = 1; m <= 12; m++) byMonth.put(m, new ArrayList<>());
        for (DailySeriesPointDto d : daily) {
            int m = ((d.getMonth() - 1) % 12) + 1;  // normaliza a 1-12 para corridas de 2 años
            byMonth.get(m).add(d);
        }

        List<MonthlySeriesPointDto> result = new ArrayList<>();
        for (int m = 1; m <= 12; m++) {
            List<DailySeriesPointDto> days = byMonth.get(m);
            if (days.isEmpty()) continue;

            int    workDays      = 0;
            int    suspDays      = 0;
            int    arrivals      = 0;
            int    caseA         = 0;
            int    terminal      = 0;
            int    caseB         = 0;
            int    disassembled  = 0;
            double queueSum      = 0;
            int    queueCount    = 0;
            double revenue       = 0;
            double cost          = 0;

            for (DailySeriesPointDto d : days) {
                if (d.isWorkDay()) {
                    workDays++;
                    if (d.isSuspended()) suspDays++;
                    queueSum  += d.getQueueSize();
                    queueCount++;
                }
                arrivals     += d.getArrivals();
                caseA        += d.getCaseA();
                terminal     += d.getTerminalWaste();
                caseB        += d.getCaseB();
                disassembled += d.getDisassembled();
                revenue      += d.getDailyRevenue();
                cost         += d.getDailyCost();
            }

            result.add(MonthlySeriesPointDto.builder()
                    .month(m)
                    .label(MONTH_LABELS[m])
                    .workDays(workDays)
                    .suspensionDays(suspDays)
                    .arrivals(arrivals)
                    .caseA(caseA)
                    .terminalWaste(terminal)
                    .caseB(caseB)
                    .disassembled(disassembled)
                    .avgQueueSize(queueCount > 0 ? queueSum / queueCount : 0)
                    .revenue(revenue)
                    .cost(cost)
                    .netProfit(revenue - cost)
                    .build());
        }
        return result;
    }

    // ── Resumen actual (REST summary) ─────────────────────────────────────

    public PlantSnapshotDto getSummary(String runId) {
        SimulationState state = activeRuns.get(runId);
        if (state == null) throw new IllegalArgumentException("Corrida no encontrada: " + runId);
        return engine.buildSnapshot(state);
    }

    public boolean isRunning(String runId) {
        return activeRuns.containsKey(runId);
    }

    // ── SSE: registrar emitter ─────────────────────────────────────────────

    public void addEmitter(String runId, SseEmitter emitter) {
        emittersByRunId.computeIfAbsent(runId, k -> new CopyOnWriteArraySet<>()).add(emitter);

        emitter.onCompletion(() -> removeEmitter(runId, emitter));
        emitter.onTimeout(   () -> removeEmitter(runId, emitter));
        emitter.onError(e   -> removeEmitter(runId, emitter));

        log.debug("SSE emitter registrado para runId={}", runId);
    }

    // ── Tick interno (hilo scheduled) ─────────────────────────────────────

    private void tick(String runId) {
        try {
            if (pausedRuns.contains(runId)) return;

            SimulationState state = activeRuns.get(runId);
            if (state == null) return;

            // Los días no laborables (fin de semana / feriado) se procesan de corrido
            // sin esperar al próximo tick del scheduler, para que el frontend no tenga
            // que aguardar tickMs entre un día cerrado y el siguiente día hábil.
            PlantSnapshotDto snapshot;
            do {
                snapshot = engine.processTick(state);
                broadcast(runId, snapshot);

                if (snapshot.isCompleted()) {
                    log.info("Corrida {} completó su horizonte. Deteniendo.", runId);
                    stopRun(runId);
                    return;
                }
            } while (!snapshot.isWorkDay() && !pausedRuns.contains(runId));

        } catch (Exception e) {
            log.error("Error en tick de corrida {}: {}", runId, e.getMessage(), e);
        }
    }

    // ── Broadcast SSE ──────────────────────────────────────────────────────

    private void broadcast(String runId, PlantSnapshotDto snapshot) {
        Set<SseEmitter> emitters = emittersByRunId.get(runId);
        if (emitters == null || emitters.isEmpty()) return;

        // Spring serializa el DTO a JSON usando sus propios MessageConverters
        // (Jackson ya está configurado internamente por spring-boot-starter-webmvc)
        Set<SseEmitter> failed = new HashSet<>();
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().data(snapshot, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                failed.add(emitter);
            }
        }
        failed.forEach(emitters::remove);
    }

    private void removeEmitter(String runId, SseEmitter emitter) {
        Set<SseEmitter> emitters = emittersByRunId.get(runId);
        if (emitters != null) emitters.remove(emitter);
    }

    private void completeEmitters(String runId) {
        Set<SseEmitter> emitters = emittersByRunId.remove(runId);
        if (emitters == null) return;
        emitters.forEach(e -> {
            try { e.complete(); } catch (Exception ignored) {}
        });
    }
}
