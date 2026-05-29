package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Agregado mensual calculado a partir de la serie diaria. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MonthlySeriesPointDto {

    private int    month;          // 1-12
    private String label;          // "Ene", "Feb", …

    private int    workDays;       // días hábiles del mes
    private int    suspensionDays; // días hábiles bajo clausura

    private int    arrivals;
    private int    caseA;
    private int    terminalWaste;
    private int    caseB;
    private int    disassembled;

    private double avgQueueSize;   // promedio de cola al cierre de cada día hábil

    private double revenue;        // ARS
    private double cost;           // ARS
    private double netProfit;      // ARS
}
