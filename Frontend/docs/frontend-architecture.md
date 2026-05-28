# Frontend Architecture

## Stack

- React 19 + TypeScript
- Vite
- Zustand para estado global
- Recharts para visualizacion

## Modulos

- `src/app/AppLayout.tsx`: organiza cabecera, area principal y dashboard.
- `src/features/plant/PlantScene.tsx`: render de galpon en capas, estaciones, operarios y cola.
- `src/features/controls/ControlsPanel.tsx`: configuracion de escenario con sliders y acciones de corrida.
- `src/features/metrics/MetricsDashboard.tsx`: KPIs + graficos de rendimiento y comparacion.
- `src/state/simulationStore.ts`: estado de configuracion/ejecucion/snapshots.
- `src/simulation/engine/mockEngine.ts`: generador de eventos discretos mock.
- `src/services/transport/*`: abstraccion de transporte (mock/backend).

## Ciclo de actualizacion

1. `App` inicializa listeners del store, sin auto-arranque.
2. `MockSimulationTransport` dispara ticks (`setInterval`) segun `tickMs`.
3. Cada tick produce `PlantSnapshot` en `MockSimulationEngine`.
4. El store recibe snapshot y React re-renderiza planta + dashboard.

## Composicion de capas en planta

1. Capa trasera: fondo interno y camion en movimiento (derecha a izquierda).
2. Capa galpon: sprite principal con ventanas transparentes.
3. Capa interior: estaciones, operarios y cola de impresoras.
4. Profundidad local: mesa por encima del operario para tapar piernas.

La escena usa `aspect-ratio: 16 / 9` para mantener consistencia visual.

## Principios de diseno

- Tipado fuerte en toda la cadena (`SimulationConfig`, `PlantSnapshot`, etc.).
- UI desacoplada del origen de datos (mock o backend real).
- Componentes separados por dominio visual/funcional.
- Facil reemplazo del motor mock por streaming via WebSocket.
