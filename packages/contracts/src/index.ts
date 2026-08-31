/**
 * Everything that crosses a process boundary in Pollo, in four groups.
 *
 * `primitives/` is the vocabulary the other three are written in; `resources/`
 * is what REST serves; `socket/` and `streams/` are the two live protocols —
 * the WebSocket the crowd and the panel speak, and the Redis Streams the API
 * and the worker speak. `effects/` sits across them: a cue travels on the
 * socket, and the maths that turns it into light has to be identical on every
 * client, so it is part of the contract rather than of any app.
 *
 * The surface is flat on purpose. The grouping is how this package is written,
 * not how it is imported.
 */
export * from './effects/presets/index.js'
export * from './effects/preview/index.js'
export * from './effects/schemas/index.js'
export * from './primitives/geometry/index.js'
export * from './primitives/location/index.js'
export * from './primitives/position/index.js'
export * from './primitives/union/index.js'
export * from './resources/event/index.js'
export * from './resources/graph/index.js'
export * from './resources/user/index.js'
export * from './socket/directions/index.js'
export * from './socket/docs/index.js'
export * from './socket/endpoints/index.js'
export * from './socket/parse/index.js'
export * from './socket/schemas/index.js'
export * from './streams/index.js'
