import { z } from "zod";
import type { ChatToolDef } from "@/assistant/llm/client";

/**
 * The 9 railway tools. For each tool:
 *  - a Zod schema = the server-side validation boundary (arguments are
 *    validated BEFORE execution — invalid args never reach a provider), and
 *  - a JSON Schema = what the model sees (descriptions are written to guide
 *    the LLM, which is the sole decider of tool selection).
 * A unit test asserts the two stay in sync (same property names/required).
 */

const DATE_DESCRIPTION = "Journey date in YYYY-MM-DD (Asia/Kolkata). Interpret relative dates (aaj/kal/parso/tomorrow) against TODAY from the context.";

/**
 * Models frequently emit numeric-looking strings (train numbers, PNR) as
 * JSON numbers. Coercing number→string at the validation boundary is
 * deterministic technical normalization (permitted); the regex contract
 * still fully applies afterwards.
 */
const numericString = (pattern: RegExp, message: string) =>
  z
    .union([z.string(), z.number().int().nonnegative()])
    .transform((v) => String(v).trim())
    .refine((v) => pattern.test(v), message);

export const ToolNames = {
  SEARCH_TRAINS: "SEARCH_TRAINS",
  GET_TRAIN_INFO: "GET_TRAIN_INFO",
  GET_TIMETABLE: "GET_TIMETABLE",
  TRACK_TRAIN: "TRACK_TRAIN",
  CHECK_AVAILABILITY: "CHECK_AVAILABILITY",
  GET_FARE: "GET_FARE",
  CHECK_PNR: "CHECK_PNR",
  GET_CANCELLED_TRAINS: "GET_CANCELLED_TRAINS",
  GENERAL_RAILWAY_ANSWER: "GENERAL_RAILWAY_ANSWER",
  SELECT_TRAIN: "SELECT_TRAIN",
  SELECT_CLASS: "SELECT_CLASS",
  UPDATE_PASSENGER: "UPDATE_PASSENGER",
} as const;

export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];

export const SearchTrainsArgs = z.object({
  from: z.string().min(1).describe("Origin station name or code, e.g. 'Ludhiana' or 'LDH'"),
  to: z.string().min(1).describe("Destination station name or code, e.g. 'Delhi' or 'NDLS'"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").describe(DATE_DESCRIPTION),
  refresh: z.boolean().optional().describe("True when the user explicitly asks to re-check live data."),
});

export const GetTrainInfoArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("Indian train number, e.g. '12951'"),
});

export const GetTimetableArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("4-6 digit train number"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(DATE_DESCRIPTION),
});

export const TrackTrainArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("4-6 digit train number"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(DATE_DESCRIPTION),
  refresh: z.boolean().optional().describe("True when the user explicitly asks to re-check live data."),
});

export const CheckAvailabilityArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("4-6 digit train number"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(DATE_DESCRIPTION),
  from: z.string().min(1).describe("Boarding station name or code"),
  to: z.string().min(1).describe("Destination station name or code"),
  classCode: z.string().min(1).optional().describe("Class such as 'SL', '3A', '2A', '1A', 'CC'. Omit to check all classes."),
  refresh: z.boolean().optional().describe("True when the user explicitly asks to re-check live data."),
});

export const GetFareArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("4-6 digit train number"),
  from: z.string().min(1).describe("Boarding station name or code"),
  to: z.string().min(1).describe("Destination station name or code"),
  classCode: z.string().min(1).describe("Class such as 'SL', '3A', '2A', '1A', 'CC'"),
  quota: z.string().min(1).optional().describe("Quota such as 'GN' (general) or 'TQ' (tatkal). Optional."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe(`${DATE_DESCRIPTION} Optional — fares on some trains vary by date.`),
  refresh: z.boolean().optional().describe("True when the user explicitly asks to re-check live data."),
});

export const CheckPnrArgs = z.object({
  pnr: numericString(/^\d{10}$/, "PNR is exactly 10 digits").describe("The 10-digit PNR number from the ticket"),
});

export const GetCancelledTrainsArgs = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(DATE_DESCRIPTION),
  zone: z.string().min(1).optional().describe("Railway zone code such as 'NR'. Optional."),
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").optional().describe("Restrict to one train number. Optional."),
});

export const GeneralRailwayAnswerArgs = z.object({
  question: z.string().min(1).describe("The general railway question being answered from knowledge (no live data involved)"),
  language: z.enum(["hi", "hinglish", "en"]).optional().describe("Language of the user's question"),
});

export const SelectTrainArgs = z.object({
  trainNumber: numericString(/^\d{4,6}$/, "4-6 digit train number").describe("The train number to select; must exist in the current non-superseded SEARCH_TRAINS results."),
});

export const SelectClassArgs = z.object({
  classCode: z.string().min(1).max(4).describe("Travel class code as returned by the provider for the selected train, e.g. 'SL', '3A', '2A', '1A', 'CC'."),
});

/**
 * Prompt 29 — age-only argument compatibility, at the narrowest boundary.
 * Models occasionally emit the age as a JSON integer (28 instead of "28").
 * ONLY `field:"age"` with an INTEGER number value is normalized to the
 * existing string contract; every other field or value type (floats,
 * booleans, null, arrays, objects) is rejected by this same schema. No rule
 * is relaxed: the normalized string still goes through validateAge
 * (whole number, 1-120). Zod-4 superRefine keeps this a ZodObject, so
 * schema introspection (shape) and the sync test remain valid.
 */
export const UpdatePassengerArgs = z
  .object({
    passenger: z.number().int().min(1).max(6).optional().describe("1-based passenger index (default 1)."),
    field: z.enum(["name", "age", "gender", "berth"]).describe("The passenger field to validate and record."),
    value: z
      .union([z.string().min(1), z.number().int()], {
        message: "The user's answer for that field, verbatim.",
      })
      .describe("The user's answer for that field, verbatim."),
  })
  .superRefine((val, ctx) => {
    if (typeof val.value === "number") {
      if (val.field !== "age") {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "numeric values are only accepted for the age field",
        });
        return;
      }
      val.value = String(val.value);
    }
  });

export const TOOL_ARG_SCHEMAS = {
  SEARCH_TRAINS: SearchTrainsArgs,
  GET_TRAIN_INFO: GetTrainInfoArgs,
  GET_TIMETABLE: GetTimetableArgs,
  TRACK_TRAIN: TrackTrainArgs,
  CHECK_AVAILABILITY: CheckAvailabilityArgs,
  GET_FARE: GetFareArgs,
  CHECK_PNR: CheckPnrArgs,
  GET_CANCELLED_TRAINS: GetCancelledTrainsArgs,
  GENERAL_RAILWAY_ANSWER: GeneralRailwayAnswerArgs,
  SELECT_TRAIN: SelectTrainArgs,
  SELECT_CLASS: SelectClassArgs,
  UPDATE_PASSENGER: UpdatePassengerArgs,
} as const satisfies Record<ToolName, z.ZodType>;

/* ---------------- JSON Schemas shown to the model ---------------- */

const str = (description: string) => ({ type: "string", description });

export const TOOL_DEFINITIONS: ChatToolDef[] = [
  {
    type: "function",
    function: {
      name: "SEARCH_TRAINS",
      description:
        "Search trains running between two stations on a journey date. Use for 'X se Y trains' requests. Returns a list of trains with numbers, names and departure/arrival times from the live provider.",
      parameters: {
        type: "object",
        properties: {
          from: str("Origin station name or code, e.g. 'Ludhiana' or 'LDH'"),
          to: str("Destination station name or code, e.g. 'Delhi' or 'NDLS'"),
          date: str(DATE_DESCRIPTION),
          refresh: { type: "boolean", description: "Set true ONLY when the user explicitly asks to re-check / refresh live data (e.g. 'phir se check karo') — bypasses our short cache and queries the source again." },
        },
        required: ["from", "to", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_TRAIN_INFO",
      description: "Get details of one specific train by its number (route endpoints, type, days of run).",
      parameters: {
        type: "object",
        properties: { trainNumber: str("4-6 digit Indian train number, e.g. '12951'") },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_TIMETABLE",
      description: "Get the full station-by-station timetable (arrival/departure/halt) of a train.",
      parameters: {
        type: "object",
        properties: {
          trainNumber: str("4-6 digit train number"),
          date: str(DATE_DESCRIPTION),
        },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "TRACK_TRAIN",
      description: "Get the live running status of a train on a date: current/last station, delay, running or not.",
      parameters: {
        type: "object",
        properties: {
          trainNumber: str("4-6 digit train number"),
          date: str(DATE_DESCRIPTION),
          refresh: { type: "boolean", description: "Set true ONLY when the user explicitly asks to re-check / refresh live data (e.g. 'phir se check karo') — bypasses our short cache and queries the source again." },
        },
        required: ["trainNumber", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "CHECK_AVAILABILITY",
      description:
        "Check seat/berth availability for a train between stations on a date. Results like RAC, WL(n), REGRET or 'no seats' are valid outcomes, not errors.",
      parameters: {
        type: "object",
        properties: {
          trainNumber: str("4-6 digit train number"),
          date: str(DATE_DESCRIPTION),
          from: str("Boarding station name or code"),
          to: str("Destination station name or code"),
          classCode: str("Optional class: 'SL','3A','2A','1A','CC',… Omit to check all classes."),
          refresh: { type: "boolean", description: "Set true ONLY when the user explicitly asks to re-check / refresh live data (e.g. 'phir se check karo') — bypasses our short cache and queries the source again." },
        },
        required: ["trainNumber", "date", "from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_FARE",
      description: "Get the fare for a train between stations in a given class (and optional quota).",
      parameters: {
        type: "object",
        properties: {
          trainNumber: str("4-6 digit train number"),
          from: str("Boarding station name or code"),
          to: str("Destination station name or code"),
          classCode: str("Class: 'SL','3A','2A','1A','CC',…"),
          quota: str("Optional quota: 'GN','TQ',…"),
          date: str(`${DATE_DESCRIPTION} Optional — pass the journey date when known; fares on some trains vary by date.`),
          refresh: { type: "boolean", description: "Set true ONLY when the user explicitly asks to re-check / refresh live data (e.g. 'phir se check karo') — bypasses our short cache and queries the source again." },
        },
        required: ["trainNumber", "from", "to", "classCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "CHECK_PNR",
      description:
        "Check the current status of a 10-digit PNR. Statuses like CNF, RAC, WL(n) are valid outcomes, not errors.",
      parameters: {
        type: "object",
        properties: { pnr: str("Exactly 10 digits") },
        required: ["pnr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_CANCELLED_TRAINS",
      description: "Get cancelled/diverted/rescheduled trains for a date (optionally filtered by zone or train).",
      parameters: {
        type: "object",
        properties: {
          date: str(DATE_DESCRIPTION),
          zone: str("Optional railway zone code, e.g. 'NR'"),
          trainNumber: str("Optional single train number"),
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GENERAL_RAILWAY_ANSWER",
      description:
        "Call this when answering a GENERAL railway-knowledge question (definitions like WL/RAC, tatkal rules, ID rules, general advice) that needs no live data. It performs no external calls; it labels your answer as general knowledge so the UI can show provenance. NEVER call live-data tools for general questions.",
      parameters: {
        type: "object",
        properties: {
          question: str("The general question you are answering"),
          language: { type: "string", enum: ["hi", "hinglish", "en"], description: "User's language" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SELECT_TRAIN",
      description:
        "Select a train FROM THE CURRENT NON-SUPERSEDED SEARCH_TRAINS RESULTS in CONTEXT (resolve 'pehli wali', 'doosri', names or numbers against those item indexes). The backend re-validates the number against those results; a train absent from them is rejected. Call this when the user chooses a train; confirm only after the tool returns ok.",
      parameters: {
        type: "object",
        properties: { trainNumber: str("4-6 digit train number present in the current valid search results") },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SELECT_CLASS",
      description:
        "Select the travel class for the already-selected train. The backend validates the class against the classes the provider returned for that train. If the class is unsupported, explain the verified result and ask what the user wants.",
      parameters: {
        type: "object",
        properties: { classCode: str("Class code supported on the selected train, e.g. 'SL', '3A', '2A', '1A', 'CC'") },
        required: ["classCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "UPDATE_PASSENGER",
      description:
        "Validate and record ONE passenger detail (name/age/gender, or berth as an unverified request) into the passenger form, after train+class are selected. Ask for one missing required detail at a time; never re-ask a field already present in the FORM STATE; corrections overwrite the same field. The backend validates every value before it becomes authoritative.",
      parameters: {
        type: "object",
        properties: {
          passenger: { type: "number", description: "1-based passenger index (default 1)" },
          field: { type: "string", enum: ["name", "age", "gender", "berth"], description: "Which field this answer belongs to" },
          value: { type: "string", description: "The user's answer, verbatim" },
        },
        required: ["field", "value"],
      },
    },
  },
];
