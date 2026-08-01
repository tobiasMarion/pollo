import { availableParallelism } from 'node:os'
import { parseArgs } from 'node:util'
import { z } from 'zod'

/**
 * Every knob, in one record: the usage text, the parseArgs option table and the
 * Zod schema all derive from it, so a new flag is a single entry rather than
 * three edits that drift apart.
 */
const flags = {
  event: {
    schema: z.string().uuid(),
    placeholder: '<uuid>',
    help: 'Id of an OPEN event to join. Required.',
  },
  clients: {
    schema: z.coerce.number().int().positive().default(20_000),
    placeholder: '<n>',
    help: 'How many devices to emulate.',
  },
  api: {
    schema: z
      .string()
      .url()
      .default(process.env.PUBLIC_POLLO_API_URL ?? 'http://localhost:3333'),
    placeholder: '<url>',
    help: 'Where the API lives. Defaults to PUBLIC_POLLO_API_URL.',
  },
  seed: {
    schema: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(() => Math.floor(Math.random() * 0xffff_ffff)),
    placeholder: '<n>',
    help: 'PRNG seed. Random when omitted, and always printed.',
  },
  threads: {
    schema: z.coerce.number().int().positive().default(availableParallelism()),
    placeholder: '<n>',
    help: 'Shards to spread the devices across.',
  },
  ramp: {
    schema: z.coerce.number().nonnegative().default(60),
    placeholder: '<s>',
    help: 'Seconds to spread the connections over.',
  },
  duration: {
    schema: z.coerce.number().positive().optional(),
    placeholder: '<s>',
    help: 'Stop after this many seconds. Runs until Ctrl-C when omitted.',
  },
  'report-hz': {
    schema: z.coerce.number().positive().default(1),
    placeholder: '<hz>',
    help: 'LOCATION_UPDATE rate per device.',
  },
  'distance-hz': {
    schema: z.coerce.number().positive().default(0.5),
    placeholder: '<hz>',
    help: 'DISTANCE sweep rate per device.',
  },
  neighbors: {
    schema: z.coerce.number().int().nonnegative().default(8),
    placeholder: '<k>',
    help: 'Peers a device ranges against per sweep.',
  },
  range: {
    schema: z.coerce.number().positive().default(6),
    placeholder: '<m>',
    help: 'How far the radio can hear a peer, in meters.',
  },
  'max-edge': {
    schema: z.coerce.number().positive().optional(),
    placeholder: '<m>',
    help: 'Longest distance a device will report. Defaults to --range.',
  },
  'common-mode': {
    schema: z.coerce.number().min(0).max(1).default(0.8),
    placeholder: '<0..1>',
    help: 'Share of the GNSS error the whole crowd sees alike.',
  },
  churn: {
    schema: z.coerce.number().min(0).max(1).default(0.005),
    placeholder: '<rate>',
    help: 'Fraction of the crowd leaving and rejoining per minute.',
  },
  'move-prob': {
    schema: z.coerce.number().min(0).max(1).default(0.002),
    placeholder: '<p>',
    help: 'Chance per minute that a device walks to another seat.',
  },
  json: {
    schema: z.coerce.boolean().default(false),
    boolean: true,
    help: 'Emit NDJSON metrics instead of the dashboard.',
  },
  'no-chart': {
    schema: z.coerce.boolean().default(false),
    boolean: true,
    help: 'Keep the dashboard but drop the chart.',
  },
  help: {
    schema: z.coerce.boolean().default(false),
    boolean: true,
    help: 'Print this and exit.',
  },
} as const satisfies Record<string, FlagSpec>

interface FlagSpec {
  schema: z.ZodTypeAny
  placeholder?: string
  boolean?: true
  help: string
}

type Flags = typeof flags
type FlagName = keyof Flags

const flagNames = Object.keys(flags) as FlagName[]

const configSchema = z.object(
  Object.fromEntries(flagNames.map(name => [name, flags[name].schema])) as {
    [Name in FlagName]: Flags[Name]['schema']
  },
)

export type SimulatorConfig = z.infer<typeof configSchema>

/**
 * Widens one entry back to `FlagSpec`. Indexing the record gives the union of
 * the literal shapes, where an optional key present on only some members is not
 * readable at all.
 */
function specOf(name: FlagName): FlagSpec {
  return flags[name]
}

export function usage() {
  const invocations = flagNames.map(name => {
    const { placeholder } = specOf(name)
    return `--${name}${placeholder ? ` ${placeholder}` : ''}`
  })

  const width = Math.max(...invocations.map(invocation => invocation.length))

  const lines = flagNames.map(
    (name, index) => `  ${(invocations[index] ?? '').padEnd(width)}  ${specOf(name).help}`,
  )

  return [
    'Emulate a stadium crowd against a live Pollo event.',
    '',
    'Usage: just simulate --event <uuid> [--clients 20000] [...]',
    '',
    ...lines,
  ].join('\n')
}

/** `--help` short-circuits validation: it must work without a `--event`. */
export type ParsedArgs = { help: true } | { help: false; config: SimulatorConfig }

/**
 * Fails on the first bad value with the message Zod wrote, in the spirit of the
 * API's `env.ts`: a load test that starts and then misbehaves is worse than one
 * that refuses to start.
 */
export function parseConfig(argv: readonly string[]): ParsedArgs {
  const options = Object.fromEntries(
    flagNames.map(name => [name, { type: specOf(name).boolean ? 'boolean' : 'string' } as const]),
  )

  const { values } = parseArgs({ args: [...argv], options, strict: true })

  if (values.help === true) return { help: true }

  // `undefined` has to be dropped rather than passed through, or it overrides
  // the schema default with an explicit "absent".
  const provided = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )

  const parsed = configSchema.safeParse(provided)

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      issue => `  --${issue.path.join('.')}: ${issue.message}`,
    )

    throw new Error(['Invalid arguments:', ...problems, '', usage()].join('\n'))
  }

  return { help: false, config: parsed.data }
}
