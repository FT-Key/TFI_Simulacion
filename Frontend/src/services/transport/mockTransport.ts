import { MockSimulationEngine } from '../../simulation/engine/mockEngine'
import type { PlantSnapshot, SimulationConfig } from '../../types/simulation'
import type { SimulationTransport, SnapshotListener } from './types'

export class MockSimulationTransport implements SimulationTransport {
  private listeners = new Set<SnapshotListener>()
  private engine: MockSimulationEngine | null = null
  private timer: number | null = null

  async startRun(config: SimulationConfig): Promise<void> {
    this.engine = new MockSimulationEngine(config)
    this.startLoop(config.tickMs)
  }

  async stopRun(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
    }
    this.timer = null
    this.engine = null
  }

  async updateConfig(config: SimulationConfig): Promise<void> {
    if (!this.engine) {
      return
    }

    this.engine.reconfigure(config)
    this.startLoop(config.tickMs)
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private startLoop(tickMs: number) {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
    }

    this.timer = window.setInterval(() => {
      if (!this.engine) {
        return
      }
      const snapshot = this.engine.step()
      this.emitSnapshot(snapshot)
    }, tickMs)
  }

  private emitSnapshot(snapshot: PlantSnapshot) {
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
