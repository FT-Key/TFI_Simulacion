# Backend Integration Guide (Spring Boot)

Este frontend ya esta preparado para cambiar de mock a backend real sin tocar componentes UI.

## Contratos esperados

Los contratos de datos estan en `src/types/simulation.ts`.

## REST propuesto (configuracion y corridas)

- `POST /api/simulations/runs`
  - request: `SimulationConfig`
  - response: `{ runId: string }`

- `POST /api/simulations/runs/{runId}/stop`
  - detiene corrida activa

- `GET /api/simulations/runs/{runId}/summary`
  - retorna ultimo `PlantSnapshot` consolidado

## WebSocket propuesto (tiempo real)

Endpoint sugerido: `/ws/simulations`.

Canal por corrida:
- topic: `/topic/simulations/{runId}/events`
- payload por evento: `PlantSnapshot`

## Pasos para conectar

1. Implementar `BackendSimulationTransport` en `src/services/transport/backendTransport.ts`.
2. En `src/services/transport/index.ts`, devolver instancia de backend transport.
3. Mantener shape de `PlantSnapshot` para evitar cambios en UI.
4. Gestionar reconexion y heartbeat en WebSocket.
5. Mapear errores a `simulationStore.error`.

## Recomendaciones

- Enviar eventos a intervalos regulares (200-1000 ms) para fluidez visual.
- Incluir `tick` monotono en backend para trazabilidad.
- Limitar historico de series del lado cliente para evitar crecimiento infinito.
