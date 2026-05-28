package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Evento atómico de un dispositivo: una clasificación en triaje
 * o una finalización de desensamblaje.
 *
 * El frontend los recibe como lista dentro del PlantSnapshot y los
 * reproduce de a uno para mostrar el procesamiento individual.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeviceEventDto {

    /** Número de secuencia dentro del día (1, 2, 3 …). */
    private int seq;

    /** "TRIAGE" o "DESGUACE". */
    private String eventType;

    // ── Datos del dispositivo ──────────────────────────────────────────────
    /** "INKJET" | "LASER" | "INDUSTRIAL". Nulo en TRIAGE de Caso A/Terminal. */
    private String deviceType;
    private double weightKg;
    private double processingTimeMinutes;

    // ── Resultado del triaje ───────────────────────────────────────────────
    /** "CASO_A" | "TERMINAL" | "CASO_B". Solo en eventos TRIAGE. */
    private String triageResult;
    /** Ingreso Caso A en ARS. Solo cuando triageResult = CASO_A. */
    private double caseARevenue;

    // ── Resultado del desensamblaje ────────────────────────────────────────
    /** Ingreso neto de materiales (ARS). Solo en eventos DESGUACE. */
    private double materialRevenue;
    private double plasticKg;
    private double ferrousKg;
    private double preciousKg;
    private double aluminumKg;
    private double copperKg;
}
