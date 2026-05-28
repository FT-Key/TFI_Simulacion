package com.example.backend.service;

import com.example.backend.model.LcgGenerator;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Servicio que expone la lógica matemática de Generadores.java y Pruebas.java
 * como beans Spring. Usado para crear generadores por corrida y para
 * ejecutar pruebas estadísticas sobre las muestras generadas.
 */
@Service
public class RandomGeneratorService {

    /** Crea un generador LCG con semilla dada (parámetros ANSI C por defecto). */
    public LcgGenerator createGenerator(long seed) {
        return new LcgGenerator(seed);
    }

    /** Crea un generador LCG con parámetros explícitos (como congruencialMixto original). */
    public LcgGenerator createGenerator(long seed, long a, long c, long m) {
        return new LcgGenerator(seed, a, c, m);
    }

    /** Genera una secuencia de N valores uniformes en [0,1) y la retorna. */
    public List<Double> generateUniformSamples(long seed, int cantidad) {
        LcgGenerator gen = createGenerator(seed);
        List<Double> result = new ArrayList<>(cantidad);
        for (int i = 0; i < cantidad; i++) {
            result.add(gen.next());
        }
        return result;
    }

    // ── Pruebas estadísticas (equivalente a Pruebas.java) ──────────────────

    /**
     * Prueba del Promedio: no rechaza H0 si |Z0| < zCritico.
     * H0: los números provienen de U(0,1).
     */
    public boolean pruebaPromedio(List<Double> numeros, double zCritico) {
        if (numeros.isEmpty()) return false;
        double suma = numeros.stream().mapToDouble(Double::doubleValue).sum();
        double promedio = suma / numeros.size();
        double z0 = ((promedio - 0.5) * Math.sqrt(numeros.size())) / 0.288;
        return Math.abs(z0) < zCritico;
    }

    /**
     * Prueba de Kolmogorov-Smirnov: no rechaza H0 si Dn < daCritico.
     * H0: los números provienen de U(0,1).
     */
    public boolean pruebaKolmogorovSmirnov(List<Double> numeros, double daCritico) {
        if (numeros.isEmpty()) return false;
        List<Double> sorted = new ArrayList<>(numeros);
        sorted.sort(null);
        int n = sorted.size();
        double dn = 0;
        for (int i = 0; i < n; i++) {
            double empirical = (double) (i + 1) / n;
            double diff = empirical - sorted.get(i);
            if (diff > dn) dn = diff;
        }
        return dn < daCritico;
    }
}
