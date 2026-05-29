package com.example.backend.service;

import com.example.backend.model.LcgGenerator;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Expone la lógica del generador LCG y la prueba KS como beans Spring.
 * Usado para crear generadores por corrida y para validar muestras externas.
 *
 * La validación KS durante la generación está integrada directamente en
 * LcgGenerator.next(), por lo que cada número producido ya fue aceptado
 * por la prueba antes de ser retornado.
 */
@Service
public class RandomGeneratorService {

    /** Crea un generador LCG con semilla dada (parámetros ANSI C por defecto). */
    public LcgGenerator createGenerator(long seed) {
        return new LcgGenerator(seed);
    }

    /** Crea un generador LCG con parámetros explícitos. */
    public LcgGenerator createGenerator(long seed, long a, long c, long m) {
        return new LcgGenerator(seed, a, c, m);
    }

    /** Genera N valores uniformes en [0,1) con el LCG validado y los retorna. */
    public List<Double> generateUniformSamples(long seed, int cantidad) {
        LcgGenerator gen = createGenerator(seed);
        List<Double> result = new ArrayList<>(cantidad);
        for (int i = 0; i < cantidad; i++) {
            result.add(gen.next());
        }
        return result;
    }

    // ── Prueba estadística ────────────────────────────────────────────────────

    /**
     * Prueba de Kolmogorov-Smirnov bilateral sobre una muestra dada (α = 0.05).
     *
     * Calcula D = max(D+, D−) sobre la muestra ordenada y lo compara contra
     * el valor crítico aproximado 1.36 / √n.
     *
     * Retorna true si no se rechaza H₀ (la muestra es compatible con U(0,1)).
     */
    public boolean pruebaKolmogorovSmirnov(List<Double> numeros) {
        if (numeros == null || numeros.isEmpty()) return false;
        List<Double> sorted = new ArrayList<>(numeros);
        sorted.sort(null);
        int    n    = sorted.size();
        double dMax = 0.0;
        for (int i = 0; i < n; i++) {
            double dPlus  = (double)(i + 1) / n - sorted.get(i);
            double dMinus = sorted.get(i) - (double) i / n;
            dMax = Math.max(dMax, Math.max(dPlus, dMinus));
        }
        double dCritical = 1.36 / Math.sqrt(n);
        return dMax <= dCritical;
    }
}
