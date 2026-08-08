/**
 * Bootstraps a shard thread. `Worker`'s `execArgv` silently drops `--import`, so
 * the tsx loader has to be registered from inside the thread rather than passed
 * to it.
 *
 * Plain JavaScript by necessity: it runs before there is anything to compile
 * TypeScript with.
 */
import { register } from 'tsx/esm/api'

register()

await import('./shard.ts')
