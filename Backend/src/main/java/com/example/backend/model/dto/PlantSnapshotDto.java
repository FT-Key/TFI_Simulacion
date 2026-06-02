package com.example.backend.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** Estado completo del galpón enviado por SSE en cada tick (1 tick = 1 día simulado). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PlantSnapshotDto {

    // ── Reloj ──────────────────────────────────────────────────────────────────
    private int     tick;                // = currentDay (1-365)
    private int     currentDay;
    private int     currentMonth;        // 1-12
    private int     dayOfMonth;          // 1-31 dentro del mes
    private int     dayOfWeek;           // 1=Lunes … 7=Domingo
    private boolean peakMonth;           // dic, ene, jun, jul
    private boolean workDay;             // lunes-viernes Y no es feriado
    private String  holidayName;         // nombre del feriado nacional, null si día normal

    @Getter(onMethod_ = @JsonProperty("isCompleted"))
    private boolean completed;

    // ── Estado de cola / suspensión ────────────────────────────────────────────
    private int     queueSize;
    private boolean suspended;
    private int     suspensionDaysRemaining;
    private int     totalSuspensions;

    // ── Métricas del día (se resetean cada tick) ──────────────────────────────
    private int    dailyArrivals;
    private int    dailyCaseA;
    private int    dailyTerminalWaste;
    private int    dailyCaseB;
    private int    dailyDisassembled;
    private double dailyCaseARevenue;    // ARS
    private double dailyMaterialRevenue; // ARS
    private double dailyLaborCost;        // ARS
    private double dailyOpportunityInfo; // ARS potencial perdido por clausura (solo informativo, no se resta)
    private double dailyNetProfit;        // ARS

    // ── Acumulados desde el inicio de la corrida ──────────────────────────────
    private int    totalArrived;
    private int    totalCaseA;
    private int    totalTerminalWaste;
    private int    totalDisassembled;

    private double totalCaseARevenue;    // ARS
    private double totalMaterialRevenue; // ARS
    private double totalLaborCost;       // ARS
    private double totalOpportunityCost; // ARS potencial acumulado no percibido durante clausuras (informativo)
    private double totalLogisticCost;    // ARS (cargo fijo $700 000 por cada suspensión)
    private double totalNetProfit;       // ARS = ingresos - todos los costos

    // ── KPIs ──────────────────────────────────────────────────────────────────
    private KpiSnapshotDto kpis;

    // ── Estaciones de desensamblaje ────────────────────────────────────────────
    private List<StationSnapshotDto> stations;

    // ── Materiales recuperados acumulados (kg por categoría) ──────────────────
    private Map<String, Double> materialRecoveredKg;

    // ── Serie histórica (todos los días transcurridos) ─────────────────────────
    private List<DailySeriesPointDto> dailySeries;

    // ── Eventos individuales del día (triage + desguace, para replay en el front) ──
    private List<DeviceEventDto> deviceEvents;
}
