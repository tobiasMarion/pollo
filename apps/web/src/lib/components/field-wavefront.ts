import type { Effect } from '@pollo/contracts'
import type { Vector3 } from '@pollo/geometry'
import type { CanvasPoint } from './field-camera'

type Projection = (point: Vector3) => CanvasPoint

const meters = (seconds: number, perUnit: number) => (perUnit > 0 ? seconds / perUnit : 0)

/** Draw the cue's leading edge in the same field coordinates as the crowd. */
export function drawWavefront(
  context: CanvasRenderingContext2D,
  effect: Effect,
  elapsed: number,
  center: Vector3,
  reach: number,
  scale: number,
  project: Projection,
) {
  const fieldLine = (from: Vector3, to: Vector3) => {
    const a = project(from)
    const b = project(to)
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
  }

  context.strokeStyle = 'rgba(245, 242, 252, 0.3)'
  context.lineWidth = 1.5
  context.beginPath()

  switch (effect.name) {
    case 'PULSE': {
      const radius = meters(elapsed, effect.spreadDelayPerUnit) * scale
      const at = project(center)
      context.moveTo(at.x + radius, at.y)
      context.arc(at.x, at.y, radius, 0, Math.PI * 2)
      break
    }

    case 'WAVE': {
      const offset = meters(elapsed, effect.spreadDelayPerUnit)

      for (const sign of [-1, 1]) {
        const shift = sign * offset

        if (effect.direction === 'X') {
          fieldLine(
            { x: center.x + shift, y: center.y - reach, z: center.z },
            { x: center.x + shift, y: center.y + reach, z: center.z },
          )
        } else if (effect.direction === 'Y') {
          fieldLine(
            { x: center.x - reach, y: center.y + shift, z: center.z },
            { x: center.x + reach, y: center.y + shift, z: center.z },
          )
        } else {
          fieldLine(
            { x: center.x - reach, y: center.y, z: center.z + shift },
            { x: center.x + reach, y: center.y, z: center.z + shift },
          )
        }
      }
      break
    }

    case 'ROTATE': {
      const angle = meters(elapsed, effect.spreadDelayPerRadian) - Math.PI
      fieldLine(center, {
        x: center.x + Math.cos(angle) * reach,
        y: center.y + Math.sin(angle) * reach,
        z: center.z,
      })
      break
    }

    case 'SPIRAL': {
      if (effect.radialSpeed <= 0) break

      let started = false
      for (let step = 0; step <= 90; step += 1) {
        const angle = (step / 90) * Math.PI * 2
        const spent = effect.angularSpeed > 0 ? angle / effect.angularSpeed : 0
        const radius = effect.radialSpeed * (elapsed - spent)
        if (radius <= 0) continue

        const at = project({
          x: center.x + Math.cos(angle - Math.PI) * radius,
          y: center.y - Math.sin(angle - Math.PI) * radius,
          z: center.z,
        })

        if (started) context.lineTo(at.x, at.y)
        else {
          context.moveTo(at.x, at.y)
          started = true
        }
      }
      break
    }
  }

  context.stroke()
}
