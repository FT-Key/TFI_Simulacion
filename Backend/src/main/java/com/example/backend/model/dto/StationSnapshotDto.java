package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Estado de una estación de desensamblaje en el tick actual. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StationSnapshotDto {
    private int    id;
    private int    operatorsAssigned;
    private int    dailyCompleted;
    private int    totalCompletedDevices;
    private double utilizationPct;
}
