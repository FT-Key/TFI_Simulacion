package com.example.backend.model;

/**
 * Generador Congruencial Mixto (LCG) - adaptado de Generadores.java original.
 * Parámetros de Knuth (ANSI C): a=1664525, c=1013904223, m=2^32.
 * Cada instancia es independiente y NO thread-safe (una por corrida).
 */
public class LcgGenerator {

    private long state;
    private final long a;
    private final long c;
    private final long m;

    private static final long DEFAULT_A = 1664525L;
    private static final long DEFAULT_C = 1013904223L;
    private static final long DEFAULT_M = 4294967296L; // 2^32

    public LcgGenerator(long seed) {
        this(seed, DEFAULT_A, DEFAULT_C, DEFAULT_M);
    }

    public LcgGenerator(long seed, long a, long c, long m) {
        this.a = a;
        this.c = c;
        this.m = m;
        this.state = seed & (m - 1);
    }

    /** Siguiente valor uniforme en [0, 1). */
    public double next() {
        state = (a * state + c) % m;
        return (double) state / m;
    }

    /** Uniforme continua en [min, max]. */
    public double nextUniform(double min, double max) {
        return min + next() * (max - min);
    }

    /** Entero uniforme en [min, max] inclusive. */
    public int nextInt(int min, int max) {
        return min + (int) (next() * (max - min + 1));
    }

    /**
     * Normal(mean, stdDev) via transformación Box-Muller.
     * Usa dos valores uniformes del LCG.
     */
    public double nextNormal(double mean, double stdDev) {
        double u1 = next();
        double u2 = next();
        if (u1 <= 0) u1 = 1e-10;
        double z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + stdDev * z;
    }

    public long getState() {
        return state;
    }
}
