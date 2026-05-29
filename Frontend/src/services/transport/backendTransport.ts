import type { PlantSnapshot, SimulationConfig } from '../../types/simulation'
import type { SimulationTransport, SnapshotListener } from './types'

const BASE_URL = 'http://localhost:8080'

/**
 * Transport real que se conecta al backend Spring Boot.
 *
 * Protocolo:
 *   POST /api/simulations/runs           → inicia corrida, devuelve { runId }
 *   POST /api/simulations/runs/{id}/stop → detiene corrida
 *   GET  /api/simulations/runs/{id}/stream (text/event-stream) → SSE de PlantSnapshot
 *
 * Para activar: en src/services/transport/index.ts cambiar
 *   MockSimulationTransport → BackendSimulationTransport
 */
export class BackendSimulationTransport implements SimulationTransport {
  private runId: string | null = null
  private eventSource: EventSource | null = null
  private listeners = new Set<SnapshotListener>()

  async startRun(config: SimulationConfig): Promise<void> {
    // 1. Iniciar corrida vía REST
    const res = await fetch(`${BASE_URL}/api/simulations/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })

    if (!res.ok) {
      throw new Error(`Error al iniciar corrida: ${res.status} ${res.statusText}`)
    }

    const { runId } = (await res.json()) as { runId: string }
    this.runId = runId

    // 2. Suscribirse al stream SSE
    this.openStream(runId)
  }

  async stopRun(): Promise<void> {
    this.closeStream()

    if (this.runId) {
      await fetch(`${BASE_URL}/api/simulations/runs/${this.runId}/stop`, {
        method: 'POST',
      }).catch(() => {})
      this.runId = null
    }
  }

  async pauseRun(): Promise<void> {
    if (this.runId) {
      await fetch(`${BASE_URL}/api/simulations/runs/${this.runId}/pause`, {
        method: 'POST',
      }).catch(() => {})
    }
  }

  async resumeRun(): Promise<void> {
    if (this.runId) {
      await fetch(`${BASE_URL}/api/simulations/runs/${this.runId}/resume`, {
        method: 'POST',
      }).catch(() => {})
    }
  }

  async updateConfig(config: SimulationConfig): Promise<void> {
    // Restart con la nueva config (el backend no soporta config en caliente)
    await this.stopRun()
    await this.startRun(config)
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ── Privado ──────────────────────────────────────────────────────────────

  private openStream(runId: string) {
    this.closeStream()

    const url = `${BASE_URL}/api/simulations/runs/${runId}/stream`
    console.info('[BackendTransport] Abriendo SSE stream:', url)
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      console.info('[BackendTransport] SSE conectado para runId:', runId)
    }

    this.eventSource.onmessage = (event: MessageEvent<string>) => {
      try {
        const snapshot = JSON.parse(event.data) as PlantSnapshot
        this.listeners.forEach((l) => l(snapshot))
      } catch (err) {
        console.error('[BackendTransport] Error parseando snapshot SSE:', err, '\nData cruda:', event.data)
      }
    }

    this.eventSource.onerror = (err) => {
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      const state = this.eventSource?.readyState
      console.error(
        `[BackendTransport] Error en SSE (readyState=${state}) para runId:`,
        runId,
        err,
      )
      // Solo cerrar si la conexión está definitivamente cerrada (no solo reconectando)
      if (state === EventSource.CLOSED) {
        this.closeStream()
      }
    }
  }

  private closeStream() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }
}
