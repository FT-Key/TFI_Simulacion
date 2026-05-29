# Modelo de Simulación — EMA S.R.L. Planta de Reciclaje RAEE

> Documento de referencia técnica. Describe el flujo completo de la simulación,
> todas las distribuciones usadas, cómo se generan los números aleatorios, y
> los puntos de entrada del sistema (funciones, endpoints, acciones del store).

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Generador de números aleatorios (LCG)](#2-generador-de-números-aleatorios-lcg)
3. [Escala temporal y reloj](#3-escala-temporal-y-reloj)
4. [Feriados nacionales](#4-feriados-nacionales)
5. [Flujo principal de un tick](#5-flujo-principal-de-un-tick)
6. [Paso 1 — Llegadas](#6-paso-1--llegadas)
7. [Paso 2 — Triaje y clasificación](#7-paso-2--triaje-y-clasificación)
8. [Paso 3 — Control de cola y suspensión](#8-paso-3--control-de-cola-y-suspensión)
9. [Paso 4 — Desensamblaje multicanal](#9-paso-4--desensamblaje-multicanal)
10. [Paso 5 — Recuperación de materiales](#10-paso-5--recuperación-de-materiales)
11. [Paso 6 — Costos laborales](#11-paso-6--costos-laborales)
12. [Días de suspensión (clausura)](#12-días-de-suspensión-clausura)
13. [Resumen de distribuciones](#13-resumen-de-distribuciones)
14. [Flujo del frontend — animación y replay](#14-flujo-del-frontend--animación-y-replay)
15. [API REST y SSE](#15-api-rest-y-sse)
16. [Informe final](#16-informe-final)
17. [Diagrama de flujo narrado](#17-diagrama-de-flujo-narrado)

---

## 1. Arquitectura general

```
Usuario
  │
  ▼
ControlsPanel.tsx          ← sliders de config + botones de control
  │  useSimulationStore (Zustand)
  ▼
simulationStore.ts          ← estado global: config, snapshot, eventQueue, report
  │
  ├── BackendSimulationTransport (SSE)
  │       POST  /api/simulations/runs          → inicia corrida animada
  │       GET   /api/simulations/runs/{id}/stream  → stream SSE de snapshots
  │       POST  /api/simulations/runs/{id}/pause|resume|stop
  │
  └── (botón "Finalizar e Informar")
          POST  /api/simulations/compute       → corrida completa al instante

Backend Spring Boot
  ├── SimulationController  ← recibe requests HTTP
  ├── SimulationService     ← gestiona corridas, scheduler, SSE emitters
  └── SimulationEngine      ← motor de simulación puro (sin estado propio)
         └── SimulationState  ← estado mutable de UNA corrida
```

Cada corrida animada tiene su propio `SimulationState` (incluye su propio `LcgGenerator`
con semilla `System.currentTimeMillis()`). El `SimulationEngine` no tiene estado propio:
recibe el `SimulationState` y lo muta.

---

## 2. Generador de números aleatorios (LCG)

**Archivo:** `Backend/…/model/LcgGenerator.java`

Se usa un **Generador Congruencial Mixto (LCG)** con los parámetros de Knuth (ANSI C):

```
X_{n+1} = (a · X_n + c) mod m

a = 1 664 525
c = 1 013 904 223
m = 2^32 = 4 294 967 296
```

La semilla es `System.currentTimeMillis()` al momento de crear la corrida → cada corrida
produce una secuencia diferente.

### Métodos disponibles

| Método | Fórmula | Usos |
|--------|---------|------|
| `next()` | `X/m ∈ [0,1)` | base de todos los demás |
| `nextUniform(min, max)` | `min + next()·(max−min)` | llegadas, pesos, tiempos, materiales, costo oportunidad |
| `nextInt(min, max)` | `min + (int)(next()·(max−min+1))` | no usado actualmente |
| `nextNormal(mean, σ)` | Box-Muller: consume **dos** `next()` | tiempo de proceso Láser |

**Box-Muller:**
```
u1 = next(),  u2 = next()
Z  = √(−2·ln u1) · cos(2π·u2)
resultado = mean + σ·Z
```

> Cada vez que se llama a cualquier método del LCG se avanza el estado interno.
> El orden de las llamadas es determinista dado una semilla → reproducible.

---

## 3. Escala temporal y reloj

**Archivo:** `SimulationState.java` → método `advanceDay()`

| Concepto | Valor |
|----------|-------|
| 1 tick | 1 día calendario |
| Corrida 1 año | 365 ticks (días 1–365) |
| Corrida 2 años | 730 ticks (días 1–730) |
| Jornada laboral | Lunes–Viernes, 8:00–17:00 (9 horas = 540 min) |
| Inicio año simulado | 1 de enero 2026 (jueves) |

El día de la semana se calcula con offset +3 para que el día 1 caiga en jueves:

```java
dayOfWeek = ((currentDay - 1 + 3) % 7) + 1   // 1=Lunes … 7=Domingo
```

**Mes actual** → función `dayOfYearToMonth()` que busca en el array acumulado
`MONTH_END_DAY = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365}`.

**Meses pico** (mayor demanda): enero (1), junio (6), julio (7), diciembre (12).

**Es día hábil** si: `dayOfWeek ∈ {1,2,3,4,5}` AND no es feriado nacional.

Para corridas de 2 años, el día en el año se normaliza: `dayInYear = ((currentDay−1) % 365) + 1`
antes de buscar feriados, entonces el calendario se repite igual en el año 2.

---

## 4. Feriados nacionales

**Archivo:** `SimulationState.java` → mapa estático `HOLIDAYS`

Trece feriados inamovibles (posición en el año):

| Día del año | Fecha | Nombre |
|-------------|-------|--------|
| 1 | 1 Ene | Año Nuevo |
| 83 | 24 Mar | Día Nac. de la Memoria |
| 92 | 2 Abr | Veteranos de Malvinas |
| 121 | 1 May | Día del Trabajador |
| 145 | 25 May | Revolución de Mayo |
| 168 | 17 Jun | Paso a la Inmortalidad del Gral. Güemes |
| 171 | 20 Jun | Paso a la Inmortalidad del Gral. Belgrano |
| 190 | 9 Jul | Día de la Independencia |
| 229 | 17 Ago | Paso a la Inmortalidad del Gral. San Martín |
| 285 | 12 Oct | Respeto a la Diversidad Cultural |
| 324 | 20 Nov | Soberanía Nacional |
| 342 | 8 Dic | Inmaculada Concepción |
| 359 | 25 Dic | Navidad |

En días feriados o fines de semana: **no hay llegadas, triaje ni desguace**.
El backend los procesa en ráfaga (sin esperar `tickMs`) dentro del `do-while` de
`SimulationService.tick()`.

---

## 5. Flujo principal de un tick

**Archivo:** `SimulationEngine.java` → `processTick(SimulationState state)`

```
processTick(state)
  │
  ├── state.advanceDay()           ← avanza reloj, recalcula mes/dow/feriado/completado
  ├── state.resetDailyMetrics()    ← vacía contadores diarios y todayEvents
  │
  ├── [si state.isCompleted()] → buildSnapshot() y retornar
  │
  ├── [si state.isSuspended()]
  │     └── processSuspensionDay()
  │
  ├── [si state.isWorkDay()]
  │     └── processWorkDay()
  │
  └── recalcTotals()  →  appendDailySeries()  →  buildSnapshot()
```

El snapshot resultante (`PlantSnapshotDto`) incluye todos los campos del estado más
la lista `deviceEvents` (eventos individuales de ese día para el replay del frontend).

---

## 6. Paso 1 — Llegadas

**Función:** `SimulationEngine.generateArrivals(state)`

La cantidad de equipos que llegan cada día hábil se genera con **Uniforme discreta**:

| Tipo de mes | Distribución | Rango |
|-------------|-------------|-------|
| Mes normal | U[35, 45] | redondeado al entero más cercano |
| Mes pico (ene, jun, jul, dic) | U[50, 70] | redondeado al entero más cercano |

```java
return (int) Math.round(rng.nextUniform(min, max));
// Consume 1 número del LCG
```

El resultado se guarda en `state.dailyArrivals` y se acumula en `state.totalArrived`.

---

## 7. Paso 2 — Triaje y clasificación

**Función:** `SimulationEngine.classifyArrivals(state, n)`

Por cada uno de los `n` equipos llegados se consumen **2 números del LCG**
(salvo Caso A o Terminal que consumen 1):

```
Para cada equipo i ∈ [1..n]:

  r1 = rng.next()   ← 1er número

  r1 < 0.15  → CASO A  (equipo funcional, antigüedad < 7 años)
    │              revenue = nextUniform(120 000, 180 000)  ← 2do número
    │              Evento TRIAGE { triageResult: "CASO_A", caseARevenue }
    │
  r1 ≥ 0.15  → Inoperable (85%)
    │
    ├── r2 = rng.next()   ← 2do número
    │
    ├── r2 < 0.10  → TERMINAL  (destrucción total / exposición química)
    │              Evento TRIAGE { triageResult: "TERMINAL" }
    │
    └── r2 ≥ 0.10  → CASO B  (módulos internos preservados → desguace)
                   generateDevice(rng)  ← consume 3 números más
                   disassemblyQueue.add(device)
                   Evento TRIAGE { triageResult: "CASO_B", deviceType, weightKg, procTime }
```

**Probabilidades efectivas:**
- Caso A: 15%
- Terminal: 85% × 10% = 8.5%
- Caso B: 85% × 90% = 76.5%

### Generación de dispositivo Caso B

**Función:** `SimulationEngine.generateDevice(rng)` → consume **3 números del LCG**

**Tipo de dispositivo** — `selectType(rng)` — 1 número:

| r | Tipo | Descripción |
|---|------|-------------|
| < 0.30 | INKJET | Hogareña liviana (30%) |
| 0.30–0.80 | LASER | Láser de oficina (50%) |
| ≥ 0.80 | INDUSTRIAL | Industrial pesada (20%) |

**Peso** — `generateWeight(type, rng)` — 1 número:

| Tipo | Distribución |
|------|-------------|
| INKJET | U[4, 6] kg |
| LASER | U[12, 18] kg |
| INDUSTRIAL | U[45, 70] kg |

**Tiempo de procesamiento** — `generateProcessingTime(type, rng)` — 1 número (INKJET/INDUSTRIAL) o **2 números** (LASER):

| Tipo | Distribución | Parámetros |
|------|-------------|-----------|
| INKJET | Uniforme | U[39, 59] min |
| LASER | Normal truncada | N(55, 4.5) min, mínimo 30 min — usa Box-Muller → **2 números LCG** |
| INDUSTRIAL | Uniforme | U[60, 83] min |

> El tiempo de proceso LASER consume **2 números** en lugar de 1 por Box-Muller.
> El total de números LCG por equipo Caso B varía entre 3 y 4.

---

## 8. Paso 3 — Control de cola y suspensión

**Función:** dentro de `processWorkDay(state)`, `SimulationEngine.java`

Inmediatamente después del triaje se verifica:

```
if (!suspended && disassemblyQueue.size() >= 250)
    → suspended = true
    → suspensionDaysRemaining = 7
    → LOG: "COLA SATURADA"
```

**Umbral de clausura:** cola ≥ 250 dispositivos.
**Duración:** 7 días calendario (incluyendo fines de semana, que no descuentan trabajo).

La clausura **no interrumpe** el desguace del día en curso: el paso 4 siempre se ejecuta,
incluso si la suspensión acaba de activarse.

---

## 9. Paso 4 — Desensamblaje multicanal

**Función:** `SimulationEngine.processDisassemblyQueue(state)`

Modelo **M/G/c** — `c` canales (estaciones) en paralelo, disciplina FIFO.

```
Capacidad por estación = operatorsPerStation × 540 min

Para cada estación (en orden 1, 2, 3…):
  remaining = stationCapacity

  Mientras queue no esté vacía:
    next = queue.peek()
    si remaining < next.processingTime → break  (no cabe → pasar a siguiente estación)
    queue.poll()
    remaining -= next.processingTime
    station.recordDeviceProcessed(next.processingTime)
    recoverMaterialValue(next, state)   ← genera evento DESGUACE + consume ~5 números LCG
```

Las estaciones trabajan en **paralelo real** (todas durante la misma jornada de 9 h).
La iteración secuencial es solo implementación — en tiempo simulado ocurren simultáneamente.

**Utilización de estación:**
```
utilizationPct = dailyCapacityUsedMinutes / (operatorsAssigned × 540) × 100
```

---

## 10. Paso 5 — Recuperación de materiales

**Función:** `SimulationEngine.recoverMaterialValue(device, state)`

Por cada dispositivo desarmado se consumen **5 números del LCG** (uno por fracción variable):

| Material | Fracción del peso | Distribución | Precio ARS/kg |
|----------|-----------------|-------------|--------------|
| Plástico | 40%–50% del peso | U[0.40, 0.50] | 800 |
| Ferroso | 25%–30% del peso | U[0.25, 0.30] | 400 |
| Preciosos (oro, plata, paladio) | 5%–10% del peso | U[0.05, 0.10] | 4 500 |
| Aluminio | 2% fijo | constante | 1 800 |
| Cobre | 2% fijo | constante | 6 200 |
| Peligroso (mercurio, plomo…) | 5% fijo | constante | −1 200 (costo) |

```
valor = plasticoKg×800 + ferrosoKg×400 + preciosKg×4500
      + aluminioKg×1800 + cobreKg×6200
      − peligrosoKg×1200
```

Se genera un evento `DESGUACE` con todos los kg por categoría y el valor neto.
Los kg se acumulan en `state.materialRecoveredKg` (mapa por categoría).

---

## 11. Paso 6 — Costos laborales

**Función:** `SimulationEngine.calculateLaborCost(state)`

```
totalOperarios = triageOperators + (activeStations × operatorsPerStation)
costoNomina    = totalOperarios × 9 horas × $3 500/hora
```

Es un costo fijo del día: **no varía con la cantidad de dispositivos procesados**.
Se aplica tanto en días hábiles normales como en días hábiles durante clausura.

---

## 12. Días de suspensión (clausura)

**Función:** `SimulationEngine.processSuspensionDay(state)`

Durante los 7 días de clausura, en cada día hábil:

1. **Costo de oportunidad** — consume **1 número del LCG**:
   ```
   costo = U[$2 800 000, $4 200 000]   (ARS/día)
   ```
   Se genera evento `SUSPENSION_DAY { suspensionPenalty, suspensionDaysLeft }`.

2. **Las estaciones siguen trabajando** para evacuar la cola:
   → llama igualmente a `processDisassemblyQueue(state)` y `calculateLaborCost(state)`.

3. **No hay llegadas ni triaje** (suspensión de recepción).

Al finalizar el 7mo día (`suspensionDaysRemaining == 0`):
- **Cargo logístico fijo:** $350 000 ARS acumulado en `totalLogisticCost`.
- Evento `SUSPENSION_END { suspensionPenalty: 350 000 }`.
- `suspended = false`, `totalSuspensions++`.

Los fines de semana dentro de la clausura no generan costo de oportunidad ni trabajo,
pero sí descuentan días del contador.

---

## 13. Resumen de distribuciones

| Variable | Distribución | Parámetros | Números LCG |
|----------|-------------|-----------|-------------|
| Llegadas (mes normal) | Uniforme discreta | U[35, 45] | 1 |
| Llegadas (mes pico) | Uniforme discreta | U[50, 70] | 1 |
| Clasificación (tipo equipo) | Bernoulli por umbrales | p(A)=0.15, p(T)=0.085, p(B)=0.765 | 1–2 |
| Revenue Caso A | Uniforme continua | U[120 000, 180 000] ARS | 1 |
| Tipo dispositivo Caso B | Uniforme por umbrales | INKJET 30%, LASER 50%, IND 20% | 1 |
| Peso INKJET | Uniforme continua | U[4, 6] kg | 1 |
| Peso LASER | Uniforme continua | U[12, 18] kg | 1 |
| Peso INDUSTRIAL | Uniforme continua | U[45, 70] kg | 1 |
| Tiempo proceso INKJET | Uniforme continua | U[39, 59] min | 1 |
| Tiempo proceso LASER | Normal truncada | N(55, 4.5) min, mín 30 | 2 (Box-Muller) |
| Tiempo proceso INDUSTRIAL | Uniforme continua | U[60, 83] min | 1 |
| Fracción plástico | Uniforme continua | U[0.40, 0.50] | 1 |
| Fracción ferroso | Uniforme continua | U[0.25, 0.30] | 1 |
| Fracción preciosos | Uniforme continua | U[0.05, 0.10] | 1 |
| Costo oportunidad clausura | Uniforme continua | U[2 800 000, 4 200 000] ARS | 1 |

> Aluminio (2%), cobre (2%) y residuo peligroso (5%) son fracciones **fijas** — no consumen LCG.

---

## 14. Flujo del frontend — animación y replay

**Archivo:** `Frontend/src/state/simulationStore.ts`

### Recepción de snapshot (SSE)

Cuando llega un `PlantSnapshot` del backend por SSE:

```
transport.subscribe((incoming) → {
  1. Separar events: triageEvents, disassemblyEvents, suspDayEvents, suspEndEvents
  2. interleaveEvents(triage, desguace, dayNum, triageOps, stations, opsPerStation)
       → asigna simTimeMinutes a cada evento
       → ordena por tiempo simulado
  3. Armar cola: [ARRIVALS_sentinel, ...interleaved, DAY_END_sentinel]
  4. Calcular revealIntervalMs (adaptativo según tickMs y cantidad de eventos)
  5. Guardar snapshot en pendingDaySnapshots.set(dayNum, incoming)
  6. Agregar todo a eventQueue
})
```

### Cálculo de tiempos simulados (`interleaveEvents`)

**Triaje** — con `triageOperators` operarios en paralelo:
```
simTimeMinutes[i] = 08:00 + (floor(i / triageOperators) + 1) × 6 min
```
Cada 6 min simulados se clasifican `triageOperators` equipos simultáneamente.

**Desguace** — con estaciones y operarios en paralelo:
```
Por cada dispositivo en orden FIFO del backend:
  1. Si no cabe en la estación actual (misma lógica que backend) → avanzar estación
  2. Dentro de la estación, asignar al operario libre más temprano (earliest job first)
  3. workerTime[st][op] += processingTime
  4. simTimeMinutes = 08:06 + workerTime[st][op]   (08:06 = primer triaje terminado)
```

### Reveal de eventos

`revealNextEvent()` se llama mediante `setInterval` cada `revealIntervalMs` ms:

```
Cola vacía y pendingSnapshot:
  → aplicar snapshot autoritativo
  → si isCompleted: setTimeout(2s) → buildReportFromSnapshot() → set({ report })

Evento ARRIVALS (sentinel inicio de día):
  → applyClockAndCosts(snapshot, incomingDay)  ← actualiza reloj y costos fijos
  → snapshot.dailyArrivals conocido de inmediato

Evento DAY_END (sentinel fin de día):
  → si 1× y día hábil: revealPausedUntil = now + 5 000 ms  ← pausa entre días

Eventos TRIAGE / DESGUACE / SUSPENSION_*:
  → applyEventToSnapshot(snapshot, event)  ← acumula ingresos/cantidades incrementalmente
```

**Velocidades y revealIntervalMs:**

| Velocidad | tickMs | revealIntervalMs (~90 eventos/día) |
|-----------|--------|----------------------------------|
| ×1 | 1 620 000 ms | ~18 000 ms / evento (adaptativo) |
| ×10 | 162 000 ms | ~1 800 ms / evento |
| ×60 | 27 000 ms | ~300 ms / evento |
| ×540 | 3 000 ms | 50 ms / evento (mínimo) |

---

## 15. API REST y SSE

**Archivo:** `Backend/…/controller/SimulationController.java`

### Corrida animada (tick a tick)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/simulations/runs` | Inicia corrida. Body: `SimulationConfigDto`. Respuesta: `{ runId }`. El backend lanza un `ScheduledExecutorService` que llama a `processTick()` cada `tickMs` ms. |
| GET | `/api/simulations/runs/{id}/stream` | Stream SSE. Cada tick envía un `PlantSnapshotDto` serializado como JSON. `SseEmitter` con timeout 0 (sin límite). |
| POST | `/api/simulations/runs/{id}/pause` | Agrega runId a `pausedRuns`. El scheduler sigue corriendo pero `tick()` hace early return. |
| POST | `/api/simulations/runs/{id}/resume` | Quita runId de `pausedRuns`. |
| POST | `/api/simulations/runs/{id}/stop` | Cancela `ScheduledFuture`, elimina estado, cierra emitters. |
| GET | `/api/simulations/runs/{id}/summary` | Retorna el último snapshot disponible (no streaming). |

**Días no laborables:** el backend los procesa en ráfaga dentro del mismo tick sin esperar al siguiente `scheduleAtFixedRate`:

```java
do {
    snapshot = engine.processTick(state);
    broadcast(runId, snapshot);
} while (!snapshot.isWorkDay() && !pausedRuns.contains(runId));
```

El frontend los recibe casi instantáneamente y los revela a 200 ms por evento.

### Corrida completa al instante (informe)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/simulations/compute` | Ejecuta todos los ticks en loop sin delays. Body: `SimulationConfigDto`. Respuesta: `SimulationReportDto` completo. Tiempo típico: < 100 ms para 1 año. |

`SimulationReportDto` incluye: totales, `dailySeries` (365/730 puntos), `monthlySeries`
(12 puntos agregados), materiales, KPIs, estaciones y tiempo de cómputo.

### SimulationConfigDto (body de todos los endpoints)

```json
{
  "triageOperators":         2,
  "activeStations":          3,
  "operatorsPerStation":     3,
  "tickMs":                  27000,
  "simulationDurationYears": 1
}
```

---

## 16. Informe final

Hay dos caminos para llegar al informe:

### A) Fin natural de la simulación

Cuando el backend envía el último snapshot con `isCompleted = true`, el frontend lo encola
normalmente. Cuando la cola de eventos se vacía y se aplica ese snapshot final:

```javascript
// simulationStore.ts → revealNextEvent()
if (wasCompleted) {
    setTimeout(() => {
        const report = buildReportFromSnapshot(snapshot, config, 'run')
        set({ report })
    }, 2_000)   // 2 s de gracia para ver el estado final
}
```

`buildReportFromSnapshot()` construye el informe directo del snapshot acumulado
en el store (mismo run, misma semilla aleatoria que se animó).

### B) Botón "Finalizar e Informar"

```javascript
// simulationStore.ts → computeReport()
1. transport.stopRun()           ← detiene animación
2. fetch POST /api/simulations/compute  ← backend corre año entero al instante
3. Mapear respuesta → SimulationReport { source: 'computed' }
4. set({ report })
```

En este caso el informe proviene de una **corrida nueva** con diferente semilla
(indicado como "Corrida de referencia" en el header del informe).

### Agregados mensuales (`buildMonthlySeries`)

Tanto el frontend (`simulationStore.ts`) como el backend (`SimulationService.java`)
implementan la misma lógica: para cada mes (y año si es corrida de 2 años) se agregan:

- Días hábiles, días en clausura
- Sumatorias: llegadas, Caso A, terminal, Caso B, desarmados
- Promedio de cola (solo días hábiles)
- Sumatoria: ingresos, costos, resultado neto

---

## 17. Diagrama de flujo narrado

```
INICIO DE CORRIDA
─────────────────
Usuario ajusta sliders (triageOps, stations, opsPerStation, tickMs, durationYears)
→ ControlsPanel.tsx pulsa "Iniciar simulación"
→ simulationStore.startSimulation(config)
→ BackendSimulationTransport.startRun(config)
→ POST /api/simulations/runs  { config }
→ SimulationService.startRun(config)
    │ Crea SimulationState (runId, config, LCG con semilla = now)
    │ Registra en activeRuns
    └ scheduleAtFixedRate(tick(), delay=500ms, period=tickMs)

═══════════════════════════════════════════════════════════
CADA TICK (cada tickMs ms, en hilo del scheduler)
═══════════════════════════════════════════════════════════

SimulationService.tick(runId)
  └─ SimulationEngine.processTick(state)
        │
        ├─ advanceDay()
        │    LCG no se toca aquí. Solo aritmética de calendario.
        │
        ├─ resetDailyMetrics()   ← todayEvents.clear(), eventSeq=0
        │
        ├─ [si completado] buildSnapshot() → broadcast → return
        │
        ├─ [si suspendido]
        │    ├─ [si workDay]
        │    │    ├─ rng.nextUniform(2.8M, 4.2M)  ← costo oportunidad (1 LCG)
        │    │    ├─ Evento SUSPENSION_DAY
        │    │    ├─ processDisassemblyQueue()     ← ver abajo
        │    │    └─ calculateLaborCost()
        │    │
        │    └─ suspensionDaysRemaining--
        │         [si == 0] totalLogisticCost += 350 000
        │                   Evento SUSPENSION_END
        │                   suspended = false
        │
        └─ [si workDay normal]
             │
             ├─ PASO 1: generateArrivals()
             │    └─ rng.nextUniform(35,45) o (50,70)  → 1 LCG
             │
             ├─ PASO 2: classifyArrivals(n)
             │    Para cada equipo (n veces):
             │      rng.next()  → ¿Caso A / inoperable?  (1 LCG)
             │      si Caso A:
             │        rng.nextUniform(120k,180k)  → revenue  (1 LCG)
             │        Evento TRIAGE CASO_A
             │      si inoperable:
             │        rng.next()  → ¿terminal / Caso B?  (1 LCG)
             │        si terminal:
             │          Evento TRIAGE TERMINAL
             │        si Caso B:
             │          selectType()  → rng.next()  (1 LCG)
             │          generateWeight()  → rng.next()  (1 LCG)
             │          generateProcessingTime():
             │            INKJET/IND → rng.next()  (1 LCG)
             │            LASER → rng.next() × 2  (2 LCG, Box-Muller)
             │          disassemblyQueue.add(device)
             │          Evento TRIAGE CASO_B
             │
             ├─ PASO 3: ¿queue.size() >= 250?
             │    si sí → suspended=true, suspensionDaysRemaining=7
             │
             ├─ PASO 4: processDisassemblyQueue()
             │    Para cada estación (c estaciones):
             │      remaining = opsPerStation × 540
             │      Mientras queue no vacía Y next.procTime <= remaining:
             │        recoverMaterialValue(device):
             │          rng.nextUniform(0.40,0.50)  → plástico  (1 LCG)
             │          rng.nextUniform(0.25,0.30)  → ferroso   (1 LCG)
             │          rng.nextUniform(0.05,0.10)  → preciosos (1 LCG)
             │          aluminio = peso×0.02  (sin LCG)
             │          cobre    = peso×0.02  (sin LCG)
             │          peligroso = peso×0.05 (sin LCG)
             │          Acumular materialRecoveredKg
             │          Evento DESGUACE { deviceType, weight, revenue, kgXmaterial }
             │        station.recordDeviceProcessed(procTime)
             │        remaining -= procTime
             │
             └─ PASO 5: calculateLaborCost()
                  (triageOps + stations×opsPerStation) × 9 × 3500

        → recalcTotals()
        → appendDailySeries()  ← agrega punto a dailySeries
        → buildSnapshot()  ← arma PlantSnapshotDto completo (incluyendo todayEvents)

  broadcast(runId, snapshot)
    └─ SseEmitter.send(snapshot JSON)  → frontend recibe por EventSource

═══════════════════════════════════════════════════════════
FRONTEND: recepción y replay
═══════════════════════════════════════════════════════════

BackendSimulationTransport.eventSource.onmessage
  └─ JSON.parse(event.data)  →  PlantSnapshot
  └─ listeners.forEach(l => l(snapshot))
  └─ simulationStore (subscribe callback):
       │
       ├─ Separar triageEvents / disassemblyEvents / suspEvents
       ├─ interleaveEvents() → asignar simTimeMinutes a cada evento
       │    Triaje:   simTime[i] = 480 + (floor(i/triageOps)+1)×6  min
       │    Desguace: simular workerTimes[station][op] desde 486 min (08:06)
       │              → cada device al operario más libre
       │    Ordenar todo por simTimeMinutes
       │
       ├─ Calcular revealIntervalMs = tickMs / eventCount  (o 200 si no laborable)
       ├─ pendingDaySnapshots.set(dayNum, snapshot)
       └─ eventQueue.push([ARRIVALS, ...interleaved, DAY_END])

setInterval(revealNextEvent, revealIntervalMs)  ← loop de animación
  ├─ Cola vacía:
  │    aplicar pendingSnapshot autoritativo
  │    si isCompleted → setTimeout(2s) → buildReportFromSnapshot → set({report})
  │
  ├─ ARRIVALS:
  │    applyClockAndCosts(snapshot, incomingDay)
  │
  ├─ DAY_END:
  │    si 1× y workDay → revealPausedUntil = now + 5 000 ms  (pausa entre días)
  │
  └─ TRIAGE / DESGUACE / SUSPENSION_*:
       applyEventToSnapshot(snapshot, event)  → acumula ingresos/cantidades
       visibleEvents.push(event)  → actualiza log en pantalla

═══════════════════════════════════════════════════════════
FIN DE CORRIDA
═══════════════════════════════════════════════════════════

Opción A — fin natural:
  Backend envía snapshot con isCompleted=true
  Frontend procesa último DAY_END
  Cola se vacía → buildReportFromSnapshot(source='run') → AppLayout muestra ReportScreen

Opción B — botón "Finalizar e Informar":
  simulationStore.computeReport()
    → transport.stopRun()
    → POST /api/simulations/compute { config }
    → SimulationService.computeFullRun(config)
         loop sin delays: while(!state.isCompleted) engine.processTick(state)
         buildMonthlySeries(dailySeries)
         return SimulationReportDto
    → Mapear respuesta → SimulationReport { source='computed' }
    → AppLayout muestra ReportScreen
```

---

*Última actualización: generado a partir del código fuente del proyecto.*
*Archivos de referencia: `SimulationEngine.java`, `SimulationState.java`, `SimulationService.java`,*
*`LcgGenerator.java`, `StationState.java`, `SimulationController.java`,*
*`simulationStore.ts`, `backendTransport.ts`, `AppLayout.tsx`, `ReportScreen.tsx`.*
