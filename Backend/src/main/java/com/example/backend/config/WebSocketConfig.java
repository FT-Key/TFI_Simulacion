package com.example.backend.config;

import org.springframework.context.annotation.Configuration;

/**
 * Reservado para configuración de WebSocket (actualmente no utilizado).
 * La comunicación en tiempo real se realiza via SSE (Server-Sent Events)
 * usando SseEmitter de Spring MVC — no requiere STOMP ni SockJS.
 */
@Configuration
public class WebSocketConfig {
    // SSE no necesita configuración adicional aquí.
    // El endpoint /api/simulations/runs/{runId}/stream es un GET estándar
    // con produces = text/event-stream manejado por SimulationController.
}
