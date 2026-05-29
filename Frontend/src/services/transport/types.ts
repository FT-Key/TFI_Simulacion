import type { PlantSnapshot, SimulationConfig } from '../../types/simulation'

export type SnapshotListener = (snapshot: PlantSnapshot) => void

export interface SimulationTransport {
  startRun(config: SimulationConfig): Promise<void>
  stopRun(): Promise<void>
  pauseRun(): Promise<void>
  resumeRun(): Promise<void>
  updateConfig(config: SimulationConfig): Promise<void>
  subscribe(listener: SnapshotListener): () => void
}
