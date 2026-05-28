package com.example.backend.model.dto;

import lombok.Data;

/**
 * Parámetros que el frontend envía al iniciar una corrida.
 *
 * Configuración del personal:
 *   triageOperators      – operarios en el puesto de clasificación inicial (≥ 1)
 *   activeStations       – estaciones de desensamblaje en paralelo
 *   operatorsPerStation  – operarios asignados a cada estación de desguace
 *
 * Tiempo:
 *   tickMs               – milisegundos reales entre ticks (1 tick = 1 día simulado).
 *                          Valor canónico: 1 620 000 ms (27 min = 9 h × 3 min/h simulada).
 *   simulationDurationYears – horizonte de la corrida (1 o 2 años).
 */
@Data
public class SimulationConfigDto {
    private int triageOperators;
    private int activeStations;
    private int operatorsPerStation;
    private int tickMs;
    private int simulationDurationYears;
}
