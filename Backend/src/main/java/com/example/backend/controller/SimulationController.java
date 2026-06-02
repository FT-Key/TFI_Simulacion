package com.example.backend.controller;

import com.example.backend.model.dto.PlantSnapshotDto;
import com.example.backend.model.dto.SimulationConfigDto;
import com.example.backend.model.dto.SimulationReportDto;
import com.example.backend.model.dto.StartRunResponse;
import com.example.backend.service.SimulationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * API REST + SSE para gestión de corridas de simulación.
 *
 * REST:
 *   POST /api/simulations/runs              → inicia corrida, retorna { runId }
 *   POST /api/simulations/runs/{id}/stop   → detiene corrida
 *   GET  /api/simulations/runs/{id}/summary → último PlantSnapshot disponible
 *
 * SSE (streaming en tiempo real):
 *   GET  /api/simulations/runs/{id}/stream  → EventSource → PlantSnapshot por tick
 *
 * El frontend conecta usando:
 *   new EventSource('http://localhost:8080/api/simulations/runs/{runId}/stream')
 */
@CrossOrigin(origins = { "http://localhost:5173", "http://localhost:4173", "https://tfi-simulacion-bice.vercel.app" })
@RestController
@RequestMapping("/api/simulations")
@RequiredArgsConstructor
public class SimulationController {

    private final SimulationService simulationService;

    // ── Cómputo completo (sin animación) ─────────────────────────────────

    @PostMapping("/compute")
    public ResponseEntity<SimulationReportDto> compute(@RequestBody SimulationConfigDto config) {
        return ResponseEntity.ok(simulationService.computeFullRun(config));
    }

    // ── REST: inicio ──────────────────────────────────────────────────────

    @PostMapping("/runs")
    public ResponseEntity<StartRunResponse> startRun(@RequestBody SimulationConfigDto config) {
        String runId = simulationService.startRun(config);
        return ResponseEntity.ok(new StartRunResponse(runId));
    }

    // ── REST: detener ─────────────────────────────────────────────────────

    @PostMapping("/runs/{runId}/stop")
    public ResponseEntity<Void> stopRun(@PathVariable String runId) {
        simulationService.stopRun(runId);
        return ResponseEntity.noContent().build();
    }

    // ── REST: pausar / reanudar ───────────────────────────────────────────

    @PostMapping("/runs/{runId}/pause")
    public ResponseEntity<Void> pauseRun(@PathVariable String runId) {
        simulationService.pauseRun(runId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/runs/{runId}/resume")
    public ResponseEntity<Void> resumeRun(@PathVariable String runId) {
        simulationService.resumeRun(runId);
        return ResponseEntity.noContent().build();
    }

    // ── REST: último snapshot ─────────────────────────────────────────────

    @GetMapping("/runs/{runId}/summary")
    public ResponseEntity<PlantSnapshotDto> getSummary(@PathVariable String runId) {
        try {
            return ResponseEntity.ok(simulationService.getSummary(runId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── SSE: stream en tiempo real ────────────────────────────────────────

    @GetMapping(value = "/runs/{runId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamEvents(@PathVariable String runId) {
        // timeout 0 = sin límite (la corrida puede durar minutos u horas)
        SseEmitter emitter = new SseEmitter(0L);
        simulationService.addEmitter(runId, emitter);
        return emitter;
    }
}
