import { z } from "zod";

/**
 * Converts a zod schema to a plain JSON schema for structured output.
 * zod adds a "$schema" draft URL that Claude Code's schema validator does not recognize, and the
 * field carries no constraints, so it is removed.
 */
export function toOutputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest;
}
