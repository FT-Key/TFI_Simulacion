package com.example.backend.model;

import lombok.Getter;

/** Estado de runtime de una estación de desensamblaje durante la corrida. */
@Getter
public class StationState {

    private final int id;
    private final int operatorsAssigned;

    private int    totalCompletedDevices;
    private int    dailyCompleted;
    private double dailyCapacityUsedMinutes;

    /** Minutos disponibles por operario en una jornada de 9 h. */
    private static final int MINUTES_PER_OPERATOR_PER_DAY = 9 * 60; // 540

    public StationState(int id, int operatorsAssigned) {
        this.id = id;
        this.operatorsAssigned = operatorsAssigned;
    }

    public void recordDeviceProcessed(double processingTimeMinutes) {
        dailyCapacityUsedMinutes += processingTimeMinutes;
        dailyCompleted++;
        totalCompletedDevices++;
    }

    /** Utilización de la estación hoy (0-100 %). */
    public double getUtilizationPct() {
        double totalAvailable = (double) operatorsAssigned * MINUTES_PER_OPERATOR_PER_DAY;
        if (totalAvailable <= 0) return 0.0;
        return Math.min(100.0, dailyCapacityUsedMinutes / totalAvailable * 100.0);
    }

    public void resetDaily() {
        dailyCompleted = 0;
        dailyCapacityUsedMinutes = 0.0;
    }
}
