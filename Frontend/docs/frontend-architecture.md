# Frontend Architecture

## Stack

- React 19 + TypeScript
- Vite
- Zustand para estado global
- Recharts para visualizacion

## Modulos

- `src/app/AppLayout.tsx`: organiza cabecera, area principal y dashboard.
- `src/features/animation/AnimationScene.tsx`: render animado del galpon, estaciones, operarios y cola.
- `src/features/controls/ControlsPanel.tsx`: configuracion de escenario con sliders y acciones de corrida.
- `src/features/metrics/MetricsDashboard.tsx`: KPIs + graficos de rendimiento y comparacion.
- `src/features/history/HistoryScreen.tsx`: historial de corridas guardadas.
- `src/features/report/ReportScreen.tsx`: informe final de la corrida.
- `src/state/simulationStore.ts`: estado de configuracion/ejecucion/snapshots.
- `src/services/transport/backendTransport.ts`: transporte SSE al backend real.

## Ciclo de actualizacion

1. `App` inicializa listeners del store, sin auto-arranque.
2. El usuario configura y arranca la corrida desde `ControlsPanel`.
3. `BackendSimulationTransport` abre un `EventSource` SSE al backend.
4. Cada tick del backend emite un `PlantSnapshot` JSON por SSE.
5. El store recibe el snapshot y React re-renderiza la animacion + dashboard.

## Composicion de capas en planta

1. Capa trasera: fondo interno y camion en movimiento (derecha a izquierda).
2. Capa galpon: sprite principal con ventanas transparentes.
3. Capa interior: estaciones, operarios y cola de impresoras.
4. Profundidad local: mesa por encima del operario para tapar piernas.

La escena usa `aspect-ratio: 16 / 9` para mantener consistencia visual.

## Principios de diseno

- Tipado fuerte en toda la cadena (`SimulationConfig`, `PlantSnapshot`, etc.).
- Componentes separados por dominio visual/funcional.
