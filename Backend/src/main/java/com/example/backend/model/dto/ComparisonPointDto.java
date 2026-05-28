package com.example.backend.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Comparación de material recuperado vs. baseline (matches ComparisonPoint en TS). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ComparisonPointDto {
    /** Una de: metales | plastico | partes | vidrio | aluminio | cobre */
    private String category;
    private double currentScenario;
    private double baselineDiscardAll;
}
