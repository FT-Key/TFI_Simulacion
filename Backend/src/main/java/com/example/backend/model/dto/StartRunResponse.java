package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

/** Respuesta al iniciar una corrida: ID único para identificar el WebSocket topic. */
@Data
@AllArgsConstructor
public class StartRunResponse {
    private String runId;
}
