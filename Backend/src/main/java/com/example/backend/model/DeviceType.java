package com.example.backend.model;

/**
 * Categoría de dispositivo según el modelo verbal.
 * Determina distribución de tiempo de procesamiento y peso.
 */
public enum DeviceType {
    /** 30% del flujo. Peso U[4,6]kg. Tiempo de desarme U[39,59] min. */
    INKJET,
    /** 50% del flujo. Peso U[12,18]kg. Tiempo de desarme N(55, 4.5) min. */
    LASER,
    /** 20% del flujo. Peso U[45,70]kg. Tiempo de desarme U[60,83] min. */
    INDUSTRIAL
}
