package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** KPIs acumulados de la corrida. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class KpiSnapshotDto {
    private double caseAPct;               // % Caso A sobre total llegados
    private double terminalWastePct;       // % residuo terminal sobre total llegados
    private double disassemblyPct;         // % desarmados sobre total llegados
    private double queueUtilizationPct;    // cola actual / 250 × 100
    private double stationUtilizationPct;  // utilización promedio de estaciones hoy (%)
}
