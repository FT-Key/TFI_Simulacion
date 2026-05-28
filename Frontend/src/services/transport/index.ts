import { BackendSimulationTransport } from './backendTransport'
import type { SimulationTransport } from './types'

export const createSimulationTransport = (): SimulationTransport => {
  return new BackendSimulationTransport()
}
