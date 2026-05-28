package com.example.backend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Unidad individual que recorre el sistema (impresora / escáner). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Device {
    private DeviceType type;
    private double weightKg;
    private double processingTimeMinutes;
    private DeviceOutcome outcome;
}
