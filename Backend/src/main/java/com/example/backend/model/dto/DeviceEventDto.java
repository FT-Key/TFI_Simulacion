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

    // ── Resumen de triaje diario (TRIAGE_SUMMARY) ─────────────────────────
    /** Equipos nuevos que ingresaron hoy. */
    private Integer triageNewArrivals;
    /** Equipos pendientes sin clasificar del día anterior. */
    private Integer triagePendingFromYesterday;
    /** Total a clasificar hoy = nuevos + pendientes. */
    private Integer triageTotalToClassify;
    /** Cuántos fueron efectivamente clasificados dentro de la jornada. */
    private Integer triageClassified;
    /** Cuántos quedaron sin clasificar y pasan al día siguiente. */
    private Integer triageLeftover;

    // ── Eventos de clausura ────────────────────────────────────────────────
    /**
     * OPPORTUNITY_INFO: ingreso potencial que se habría obtenido si la planta
     * hubiera recibido material ese día (solo informativo, NO se descuenta).
     * Null en todos los demás tipos de evento.
     */
    private Double opportunityAmount;
    /**
     * SUSPENSION_END: cargo logístico fijo ($700 000) al finalizar la clausura.
     * Null en todos los demás tipos.
     */
    private Double suspensionPenalty;
    /**
     * OPPORTUNITY_INFO: días de clausura que quedan ANTES de procesar este día.
     * Null en los demás tipos.
     */
    private Integer suspensionDaysLeft;
}
