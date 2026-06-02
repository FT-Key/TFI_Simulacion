package com.example.backend.model;

import java.util.ArrayDeque;

/**
 * Generador Congruencial Mixto (LCG) con validación KS integrada.
 *
 * Parámetros de Knuth (ANSI C): a=1664525, c=1013904223, m=2^32.
 * Cada instancia es independiente y NO thread-safe (una por corrida).
 *
 * Validación KS en next():
 *   Mantiene una ventana deslizante de los últimos KS_WINDOW_SIZE números
 *   generados. Cada candidato se agrega a la ventana y se aplica la prueba
 *   de Kolmogorov-Smirnov (bilateral, α=0.05). Si el candidato provoca que
 *   la ventana no pase la prueba, se descarta y se genera otro; esto se repite
 *   hasta KS_MAX_RETRIES veces. Si se agotan los intentos se acepta el último
 *   generado para evitar ciclos infinitos.
 */
public class LcgGenerator {

    // ── Parámetros del LCG ────────────────────────────────────────────────────
    private long       state;
    private final long a;
    private final long c;
    private final long m;

    private static final long DEFAULT_A = 1_664_525L;
    private static final long DEFAULT_C = 1_013_904_223L;
    private static final long DEFAULT_M = 4_294_967_296L; // 2^32

    // ── Parámetros de la validación KS ───────────────────────────────────────
    /** Tamaño de la ventana deslizante sobre la que se aplica KS. */
    private static final int    KS_WINDOW_SIZE = 100;
    // KS_MIN_SAMPLES eliminado: warmUp() garantiza ventana llena desde el inicio.
    /** Máximo de intentos si KS falla antes de aceptar de todas formas. */
    private static final int    KS_MAX_RETRIES = 10;
    /** Factor de valor crítico KS para α=0.05: D_crit = 1.36 / √n */
    private static final double KS_ALPHA_FACTOR = 1.36;

    /** Ventana deslizante de los últimos números generados. */
    private final ArrayDeque<Double> ksWindow = new ArrayDeque<>(KS_WINDOW_SIZE + 1);

    // ── Constructores ─────────────────────────────────────────────────────────

    public LcgGenerator(long seed) {
        this(seed, DEFAULT_A, DEFAULT_C, DEFAULT_M);
    }

    public LcgGenerator(long seed, long a, long c, long m) {
        this.a     = a;
        this.c     = c;
        this.m     = m;
        this.state = seed & (m - 1);
        warmUp();
    }

    /**
     * Pre-carga la ventana KS con KS_WINDOW_SIZE números de calentamiento.
     * Estos números nunca se usan en la simulación — solo sirven para que
     * desde la primera llamada real a next() la ventana ya esté llena y
     * KS aplique sin excepción.
     */
    private void warmUp() {
        for (int i = 0; i < KS_WINDOW_SIZE; i++) {
            state = (a * state + c) % m;
            ksWindow.addLast((double) state / m);
        }
    }

    // ── Generación con validación KS ──────────────────────────────────────────

    /**
     * Genera el siguiente valor uniforme en [0, 1).
     *
     * Aplica KS sobre la ventana deslizante antes de retornar el candidato.
     * Si KS falla, descarta el candidato y genera otro (hasta KS_MAX_RETRIES).
     */
    public double next() {
        for (int attempt = 0; attempt < KS_MAX_RETRIES; attempt++) {
            double candidate = rawNext();

            // Agregar a la ventana deslizante (quitar el más viejo si está llena)
            if (ksWindow.size() >= KS_WINDOW_SIZE) ksWindow.pollFirst();
            ksWindow.addLast(candidate);

            // La ventana siempre tiene KS_WINDOW_SIZE elementos (garantizado por warmUp)
            if (passesKS()) {
                return candidate;
            }

            // KS falló: quitar el candidato de la ventana y reintentar
            ksWindow.pollLast();
        }

        // Se agotaron los reintentos: aceptar el último generado de todas formas
        double last = rawNext();
        if (ksWindow.size() >= KS_WINDOW_SIZE) ksWindow.pollFirst();
        ksWindow.addLast(last);
        return last;
    }

    /** Avanza el LCG un paso y retorna el valor crudo sin validación. */
    private double rawNext() {
        state = (a * state + c) % m;
        return (double) state / m;
    }

    /**
     * Prueba de Kolmogorov-Smirnov bilateral sobre la ventana actual.
     *
     * Ordena los n valores de la ventana y calcula:
     *   D+ = max { i/n − x_(i) }
     *   D− = max { x_(i) − (i−1)/n }
     *   D  = max(D+, D−)
     *
     * Retorna true si D ≤ 1.36 / √n  (α = 0.05).
     */
    private boolean passesKS() {
        double[] sorted = ksWindow.stream()
                .mapToDouble(Double::doubleValue)
                .sorted()
                .toArray();
        int    n    = sorted.length;
        double dMax = 0.0;
        for (int i = 0; i < n; i++) {
            double dPlus  = (double)(i + 1) / n - sorted[i];   // D+
            double dMinus = sorted[i] - (double) i / n;         // D−
            dMax = Math.max(dMax, Math.max(dPlus, dMinus));
        }
        double dCritical = KS_ALPHA_FACTOR / Math.sqrt(n);
        return dMax <= dCritical;
    }

    // ── Distribuciones derivadas ──────────────────────────────────────────────

    /** Uniforme continua en [min, max]. */
    public double nextUniform(double min, double max) {
        return min + next() * (max - min);
    }

    /**
     * Normal(mean, stdDev) via transformación Box-Muller.
     * Consume dos llamadas a next() — ambas con validación KS propia.
     */
    public double nextNormal(double mean, double stdDev) {
        double u1 = next();
        double u2 = next();
        if (u1 <= 0) u1 = 1e-10;
        double z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + stdDev * z;
    }

    /** Exponencial con media {@code mean} via transformación inversa: −mean × ln(U). */
    public double nextExponential(double mean) {
        double u = next();
        if (u <= 0) u = 1e-10;
        return -mean * Math.log(u);
    }

}
