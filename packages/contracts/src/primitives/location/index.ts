import { z } from 'zod'

export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90).describe('Decimal degrees, WGS 84.'),
    longitude: z.number().min(-180).max(180).describe('Decimal degrees, WGS 84.'),
    horizontalAccuracy: z
      .number()
      .describe('Radius of uncertainty of the coordinate pair, in meters.'),
    altitude: z.number().describe('Height above the WGS 84 reference ellipsoid, in meters.'),
    verticalAccuracy: z.number().describe('Uncertainty of the altitude, in meters.'),
  })
  .describe('A GPS reading reported by a device, accuracy included.')

export type Location = z.infer<typeof locationSchema>

export const exactLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90).describe('Decimal degrees, WGS 84.'),
    longitude: z.number().min(-180).max(180).describe('Decimal degrees, WGS 84.'),
  })
  .describe('A fixed coordinate pair with no accuracy attached — used for event origins.')

export type ExactLocation = z.infer<typeof exactLocationSchema>
