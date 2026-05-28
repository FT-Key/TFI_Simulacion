import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PlantSnapshot, StationSnapshot } from '../../types/simulation'
import camionSprite from '../../assets/sprites/camion.png'
import empleadoFrame1 from '../../assets/sprites/empleado_frame1.png'
import empleadoFrame2 from '../../assets/sprites/empleado_frame2.png'
import empleadoFrame3 from '../../assets/sprites/empleado_frame3.png'
import empleadoFrenteSprite from '../../assets/sprites/empleado_frente.png'
import estacionesSprite from '../../assets/sprites/estaciones.png'
import galponSprite from '../../assets/sprites/galpon.png'
import impresoraBlancaSprite from '../../assets/sprites/impresora_blanca.png'
import impresoraNegraSprite from '../../assets/sprites/impresora_negra.png'
import impresoraOficinaSprite from '../../assets/sprites/impresora_oficina.png'
import './PlantScene.css'

const WALK_FRAMES = [empleadoFrame1, empleadoFrame2, empleadoFrame3]
const PRINTERS = [impresoraBlancaSprite, impresoraNegraSprite, impresoraOficinaSprite]

interface PlantSceneProps {
  snapshot: PlantSnapshot
  isRunning: boolean
}

export function PlantScene({ snapshot, isRunning }: PlantSceneProps) {
  const [walkFrameIndex, setWalkFrameIndex] = useState(0)
  // Íconos de cola: escala real de queueDevices, mínimo 1 si hay trabajo activo
  const rawQueueItems = Math.min(9, Math.max(0, Math.round(snapshot.queueDevices / 20)))
  const hasWork = snapshot.processedDevicesPerWeek > 0 || snapshot.queueDevices > 0 || snapshot.incomingDevicesPerWeek > 0
  const queueItems = hasWork ? Math.max(1, rawQueueItems) : rawQueueItems
  const visibleStations = snapshot.stations.slice(0, 4)
  const hasStarted = snapshot.tick > 0
  const truckVisible = isRunning && snapshot.tick < 4
  const queueUnlocked = snapshot.tick > 0
  const workUnlocked = snapshot.tick > 0
  // Operarios caminan siempre que la simulación esté activa.
  // No dependen de processedDevicesPerWeek para no congelarse durante pausas de recepción
  // (cuando la cola se vacía temporalmente pero la corrida sigue).
  const shouldWalk = isRunning && workUnlocked
  const showQueue = queueUnlocked && queueItems > 0
  const displayedWalkFrameIndex = shouldWalk ? walkFrameIndex : 0

  useEffect(() => {
    if (!shouldWalk) {
      return
    }

    const timer = window.setInterval(() => {
      setWalkFrameIndex((previous) => (previous + 1) % WALK_FRAMES.length)
    }, 120)

    return () => window.clearInterval(timer)
  }, [shouldWalk])

  return (
    <section className="plant-panel">
      <div className="plant-scene">
        <div className="scene-backdrop" />
        {truckVisible && (
          <img
            className={`truck ${hasStarted ? 'moving' : ''}`}
            src={camionSprite}
            alt="Camion de descarga"
          />
        )}
        <img className="galpon-layer" src={galponSprite} alt="Galpon de la planta" />

        <div className="stations-layer">
          {visibleStations.map((station) => (
            <StationRow
              key={station.id}
              station={station}
              standing={!shouldWalk}
              walkFrameIndex={displayedWalkFrameIndex}
              walking={shouldWalk}
            />
          ))}
        </div>

        <div className={`queue-lane ${showQueue ? 'visible' : ''}`}>
          {Array.from({ length: queueItems }, (_, index) => (
            <img
              key={`printer-${index}`}
              src={PRINTERS[index % PRINTERS.length]}
              alt="Dispositivo en cola"
              className="queue-printer"
            />
          ))}
        </div>
      </div>

      <footer className="plant-footer">
        <div>
          <span>En cola</span>
          <strong>{snapshot.queueDevices} equipos</strong>
        </div>
        <div>
          <span>
            {snapshot.granularity === 'daily'
              ? 'Hora simulada'
              : snapshot.granularity === 'weekly'
              ? 'Día simulado'
              : 'Semana simulada'}
          </span>
          <strong>
            {snapshot.granularity === 'daily'
              ? `H${snapshot.simulatedHour ?? 0} — Día ${snapshot.simulatedDay ?? 1}`
              : snapshot.granularity === 'weekly'
              ? `D${snapshot.simulatedDay ?? 0} — Sem ${snapshot.simulatedWeek ?? 1}`
              : `Sem ${snapshot.simulatedWeek ?? 0} — Mes ${snapshot.simulatedMonth ?? 1}`}
          </strong>
        </div>
        <div>
          <span>Total procesados</span>
          <strong>{snapshot.totalDisassembled} equipos</strong>
        </div>
      </footer>
    </section>
  )
}

function StationRow({
  station,
  standing,
  walkFrameIndex,
  walking,
}: {
  station: StationSnapshot
  standing: boolean
  walkFrameIndex: number
  walking: boolean
}) {
  const rowDepth = station.id

  return (
    <article className="station-row" style={{ ['--row-depth' as string]: rowDepth }}>
      <div className="station-surface">
        <div className="station-badge">EST {station.id}</div>
        <img src={estacionesSprite} alt={`Estacion ${station.id}`} className="station-base" />
        <div className="operators-strip">
          {Array.from({ length: station.operatorsAssigned }, (_, index) => {
            const isBusy = index < station.busyOperators
            const slotRatio = station.operatorsAssigned <= 1 ? 0.5 : index / Math.max(1, station.operatorsAssigned - 1)
            const homeX = 20 + slotRatio * 60
            const travelDelay = (station.id - 1) * 0.45 + index * 0.2
            const currentFrame = standing || !walking
              ? empleadoFrenteSprite
              : WALK_FRAMES[(walkFrameIndex + station.id + index) % WALK_FRAMES.length]
            return (
              <div
                key={`${station.id}-${index}`}
                className={`operator-shell ${standing ? 'standing' : ''} ${walking ? 'moving' : 'paused'}`}
                style={
                  {
                    '--home-x': `${homeX}%`,
                    '--travel-delay': `${travelDelay}s`,
                    '--carrier-cycle': '9.2s',
                  } as CSSProperties
                }
              >
                <img
                  src={currentFrame}
                  alt="Operario"
                  className={`operator-sprite ${standing ? 'standing' : ''} ${walking ? 'walk-cycle' : ''} ${isBusy || standing ? 'busy' : 'idle'}`}
                />
                {walking && (
                  <img
                    src={empleadoFrenteSprite}
                    alt="Operario trabajando"
                    className="operator-front-working"
                  />
                )}
                {walking && (
                  <img
                    src={PRINTERS[(station.id + index) % PRINTERS.length]}
                    alt="Impresora transportada"
                    className="carried-printer"
                  />
                )}
              </div>
            )
          })}
        </div>
        {walking && (
          <div className="table-printer-layer">
            {Array.from({ length: station.operatorsAssigned }, (_, index) => {
              const slotRatio =
                station.operatorsAssigned <= 1 ? 0.5 : index / Math.max(1, station.operatorsAssigned - 1)
              const homeX = 20 + slotRatio * 60
              const travelDelay = (station.id - 1) * 0.45 + index * 0.2

              return (
                <img
                  key={`bench-${station.id}-${index}`}
                  src={PRINTERS[(station.id + index) % PRINTERS.length]}
                  alt="Impresora en mesa"
                  className="table-printer"
                  style={
                    {
                      '--home-x': `${homeX}%`,
                      '--travel-delay': `${travelDelay}s`,
                      '--carrier-cycle': '9.2s',
                    } as CSSProperties
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}
