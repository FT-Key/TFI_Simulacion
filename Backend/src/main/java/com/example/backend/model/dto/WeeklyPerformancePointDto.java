package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Punto de serie temporal semanal (matches WeeklyPerformancePoint en TS). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WeeklyPerformancePointDto {
    private String week;
    private int processed;
    private int queued;
    private int discarded;
}
