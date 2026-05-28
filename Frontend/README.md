# TFI Simulacion - Frontend

Frontend del simulador de planta de reciclaje construido con React + TypeScript + Vite.

Incluye:
- vista de planta animada con sprites (galpon, estaciones, operarios, cola y camion),
- panel derecho para parametros de simulacion con sliders,
- dashboard inferior con KPIs y graficos en tiempo real,
- capa de transporte desacoplada para luego conectar REST/WebSocket de Spring Boot.

## Requisitos

- Node.js 20+
- npm 10+

## Scripts

- `npm install` instala dependencias
- `npm run dev` inicia entorno de desarrollo
- `npm run build` compila para produccion
- `npm run preview` previsualiza build local
- `npm run lint` ejecuta ESLint

## Arquitectura

Estructura principal:

- `src/app/` layout global de la app
- `src/features/plant/` escena del galpon y animaciones
- `src/features/controls/` panel de controles de corrida
- `src/features/metrics/` resumen KPI y graficos
- `src/state/` estado global (zustand)
- `src/simulation/engine/` motor mock en tiempo real
- `src/services/transport/` adapters de transporte (mock y backend placeholder)
- `src/types/` contratos tipados compartidos
- `src/assets/sprites/` sprites normalizados
- `docs/` documentacion de arquitectura, assets e integracion backend

## Flujo de datos actual

1. La app inicia en estado pausado (sin auto-start).
2. El usuario configura parametros con sliders y presiona `Iniciar simulacion`.
3. El store aplica cambios y los envia al `SimulationTransport`.
4. El transport mock ejecuta el motor de simulacion y emite snapshots.
5. Planta y dashboard consumen snapshots para renderizarse en tiempo real.

## Notas visuales de escena

- La escena principal mantiene relacion de aspecto `16:9`.
- El camion cruza de derecha a izquierda por una capa trasera.
- El galpon se dibuja encima del camion para aprovechar transparencias de ventanas.
- La cola de impresoras se muestra del lado izquierdo tras el inicio de corrida.

## Integracion posterior con backend

El punto de cambio es `src/services/transport/index.ts`:

- hoy retorna `MockSimulationTransport`.
- para backend real, se reemplaza por `BackendSimulationTransport` (ver `docs/backend-integration.md`).

La UI y el store no necesitan cambios si se respetan los contratos de `src/types/simulation.ts`.
