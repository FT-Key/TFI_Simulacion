package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Resultado completo de una corrida calculada de una sola vez.
 * Devuelto por POST /api/simulations/compute.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationReportDto {

    // ── Metadatos ─────────────────────────────────────────────────────────────
    private SimulationConfigDto config;
    private long                computeTimeMs;  // tiempo real de cómputo en ms

    // ── Totales finales ───────────────────────────────────────────────────────
    private int    totalArrived;
    private int    totalCaseA;
    private int    totalTerminalWaste;
    private int    totalCaseB;
    private int    totalDisassembled;
    private int    totalSuspensions;

    private double totalCaseARevenue;
    private double totalMaterialRevenue;
    private double totalLaborCost;
    private double totalOpportunityCost;
    private double totalLogisticCost;
    private double totalNetProfit;

    // ── Materiales recuperados (kg por categoría) ─────────────────────────────
    private Map<String, Double> materialRecoveredKg;

    // ── KPIs finales ──────────────────────────────────────────────────────────
    private KpiSnapshotDto       kpis;
    private List<StationSnapshotDto> stations;

    // ── Series ────────────────────────────────────────────────────────────────
    private List<MonthlySeriesPointDto> monthlySeries;
    private List<DailySeriesPointDto>   dailySeries;
}
