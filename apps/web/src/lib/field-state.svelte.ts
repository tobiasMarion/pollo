import type { EventGraph, Location, MessageOf, NodePosition } from '@pollo/contracts'
import { SvelteMap } from 'svelte/reactivity'

export interface DeviceState {
  deviceId: string
  location: Location | null
  position: NodePosition | null
  previousLocation: Location | null
  previousPosition: NodePosition | null
  changedAt: number
  window: number
}

export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`
}

/** The field as the panel knows it, independent of how messages arrive. */
export class FieldState {
  readonly devices = new SvelteMap<string, DeviceState>()
  readonly edges = new SvelteMap<string, { from: string; to: string; value: number }>()

  /** Replaces the whole field. Used on first load and after every reconnect. */
  replace(graph: EventGraph, now = Date.now()) {
    this.devices.clear()
    this.edges.clear()

    for (const [deviceId, metadata] of Object.entries(graph.nodes)) {
      this.devices.set(deviceId, {
        deviceId,
        location: metadata.location,
        position: metadata.position ?? null,
        previousLocation: null,
        previousPosition: null,
        changedAt: now,
        window: 0,
      })
    }

    for (const edge of graph.edges) this.edges.set(edgeKey(edge.from, edge.to), edge)
  }

  /** Applies one internally consistent server window. */
  apply(update: MessageOf<'FIELD_UPDATE'>, now = Date.now()) {
    for (const { deviceId, location } of update.locations) {
      this.upsertDevice(deviceId, now, update.window, { location })
    }

    for (const { deviceId, position } of update.placed) {
      this.upsertDevice(deviceId, now, update.window, { position })
    }

    for (const edge of update.edges) {
      const key = edgeKey(edge.from, edge.to)

      if (edge.distance === null) {
        this.edges.delete(key)
      } else {
        this.edges.set(key, { from: edge.from, to: edge.to, value: edge.distance })
      }
    }

    if (update.left.length === 0) return

    for (const deviceId of update.left) this.devices.delete(deviceId)

    const gone = new Set(update.left)

    for (const [key, edge] of this.edges) {
      if (gone.has(edge.from) || gone.has(edge.to)) this.edges.delete(key)
    }
  }

  private upsertDevice(
    deviceId: string,
    now: number,
    window: number,
    patch: { location?: Location; position?: NodePosition },
  ) {
    const existing = this.devices.get(deviceId)

    this.devices.set(deviceId, {
      deviceId,
      location: patch.location ?? existing?.location ?? null,
      position: patch.position ?? existing?.position ?? null,
      previousLocation: existing?.location ?? null,
      previousPosition: existing?.position ?? null,
      changedAt: now,
      window,
    })
  }
}

/** Positions the worker has published — the only devices worth drawing. */
export function positionedDevices(devices: Iterable<DeviceState>): DeviceState[] {
  return [...devices].filter((device): device is DeviceState & { position: NodePosition } =>
    Boolean(device.position),
  )
}
