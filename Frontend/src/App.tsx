import { useEffect } from 'react'
import { AppLayout } from './app/AppLayout'
import { useSimulationStore } from './state/simulationStore'

function App() {
  const initialize = useSimulationStore((state) => state.initialize)
  const stopSimulation = useSimulationStore((state) => state.stopSimulation)

  useEffect(() => {
    const unsubscribe = initialize()
    return () => {
      unsubscribe()
      void stopSimulation()
    }
  }, [initialize, stopSimulation])

  return <AppLayout />
}

export default App
