import { z } from "zod";

/**
 * Canonical railway domain schemas (requirement 7: never invent data).
 * Every provider payload must parse through these at the boundary;
 * anything that does not parse is rejected as VALIDATION_FAILED,
 * never coerced, guessed or partially filled.
 */

export const StationSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
export type Station = z.infer<typeof StationSchema>;

export const TrainSummarySchema = z.object({
  trainNumber: z
    .string()
    .regex(/^\d{4,6}$/, "train number must be 4-6 digits as published by the source"),
  trainName: z.string().min(1),
  from: StationSchema,
  to: StationSchema,
  departure: z.string().min(1),
  arrival: z.string().min(1),
  classes: z.array(z.string()).optional(),
});
export type TrainSummary = z.infer<typeof TrainSummarySchema>;

export const TrainDetailsSchema = TrainSummarySchema.extend({
  type: z.string().nullable().optional(),
  zones: z.array(z.string()).optional(),
});
export type TrainDetails = z.infer<typeof TrainDetailsSchema>;

export const TimetableEntrySchema = z.object({
  sequence: z.number().int().nonnegative(),
  station: StationSchema,
  arrival: z.string().nullable(),
  departure: z.string().nullable(),
  haltMinutes: z.number().int().nonnegative().nullable().optional(),
  platform: z.string().nullable().optional(),
});
export type TimetableEntry = z.infer<typeof TimetableEntrySchema>;

export const TimetableSchema = z.object({
  trainNumber: TrainSummarySchema.shape.trainNumber,
  trainName: z.string().min(1),
  date: z.string().min(1),
  entries: z.array(TimetableEntrySchema).min(1),
});
export type Timetable = z.infer<typeof TimetableSchema>;

export const LiveStatusSchema = z.object({
  trainNumber: TrainSummarySchema.shape.trainNumber,
  trainName: z.string().min(1),
  running: z.boolean().nullable(),
  lastStation: StationSchema.nullable(),
  delayMinutes: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});
export type LiveStatus = z.infer<typeof LiveStatusSchema>;

export const AvailabilityClassSchema = z.object({
  classCode: z.string().min(1),
  status: z.string().min(1),
  seatsText: z.string().nullable(),
  /**
   * Provider-reported timestamp for this availability snapshot (e.g.
   * ConfirmTkt's cacheTime), when the provider publishes one. Distinct from
   * the envelope's retrievedAt (OUR clock). Null/absent = not published —
   * never fabricated.
   */
  asOf: z.string().nullable().optional(),
});
export type AvailabilityClass = z.infer<typeof AvailabilityClassSchema>;

export const AvailabilitySchema = z.object({
  trainNumber: TrainSummarySchema.shape.trainNumber,
  date: z.string().min(1),
  from: StationSchema,
  to: StationSchema,
  classes: z.array(AvailabilityClassSchema).min(1),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const FareBreakupSchema = z.object({
  component: z.string().min(1),
  amount: z.number().nonnegative(),
});
export type FareBreakup = z.infer<typeof FareBreakupSchema>;

export const FareSchema = z.object({
  trainNumber: TrainSummarySchema.shape.trainNumber,
  classCode: z.string().min(1),
  from: StationSchema,
  to: StationSchema,
  baseFare: z.number().nonnegative(),
  totalFare: z.number().nonnegative(),
  currency: z.string().default("INR"),
  breakup: z.array(FareBreakupSchema).optional(),
});
export type Fare = z.infer<typeof FareSchema>;

export const PnrPassengerSchema = z.object({
  passengerNumber: z.number().int().positive(),
  bookingStatus: z.string().min(1),
  currentStatus: z.string().min(1),
});
export type PnrPassenger = z.infer<typeof PnrPassengerSchema>;

export const PnrStatusSchema = z.object({
  pnr: z.string().regex(/^\d{10}$/, "PNR must be exactly 10 digits"),
  trainNumber: z.string().regex(/^\d{4,6}$/).nullable(),
  trainName: z.string().nullable(),
  journeyDate: z.string().nullable(),
  chartPrepared: z.boolean(),
  passengers: z.array(PnrPassengerSchema).min(1),
});
export type PnrStatus = z.infer<typeof PnrStatusSchema>;

export const DisruptionSchema = z.object({
  trainNumber: TrainSummarySchema.shape.trainNumber,
  trainName: z.string().min(1),
  kind: z.enum(["CANCELLED", "DIVERTED", "RESCHEDULED", "PARTIALLY_CANCELLED"]),
  date: z.string().min(1),
  notice: z.string().nullable().optional(),
});
export type Disruption = z.infer<typeof DisruptionSchema>;
