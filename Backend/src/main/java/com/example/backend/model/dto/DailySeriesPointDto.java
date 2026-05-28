package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Un punto de la serie histórica diaria para gráficos. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DailySeriesPointDto {
    private int    day;
    private String label;       // "D001", "D002", …
    private int    month;
    private boolean workDay;
    private boolean suspended;
    private int    arrivals;
    private int    caseA;
    private int    terminalWaste;
    private int    caseB;
    private int    disassembled;
    private int    queueSize;
    private double dailyRevenue;    // ARS
    private double dailyCost;       // ARS
    private double dailyNetProfit;  // ARS
}
