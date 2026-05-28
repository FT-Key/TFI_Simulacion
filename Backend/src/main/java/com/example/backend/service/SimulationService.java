package com.example.backend.service;

import com.example.backend.model.SimulationState;
import com.example.backend.model.dto.PlantSnapshotDto;
import com.example.backend.model.dto.SimulationConfigDto;
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

    private final Map<String, SimulationState>          activeRuns     = new ConcurrentHashMap<>();
    private final Map<String, ScheduledFuture<?>>       scheduledRuns  = new ConcurrentHashMap<>();
    private final Map<String, Set<SseEmitter>>          emittersByRunId = new ConcurrentHashMap<>();

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
        ScheduledFuture<?> future = scheduledRuns.remove(runId);
        if (future != null) future.cancel(false);
        activeRuns.remove(runId);
        completeEmitters(runId);
        log.info("Corrida detenida: {}", runId);
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
            SimulationState state = activeRuns.get(runId);
            if (state == null) return;

            PlantSnapshotDto snapshot = engine.processTick(state);
            broadcast(runId, snapshot);

            // Auto-detener si la corrida completó su horizonte temporal
            if (snapshot.isCompleted()) {
                log.info("Corrida {} completó su horizonte. Deteniendo.", runId);
                stopRun(runId);
            }

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
