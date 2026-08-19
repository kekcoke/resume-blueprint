/**
 * Unit-aware handling for `document.margin`.
 *
 * Split out of `schema.ts` and `templates/documentConfig.ts` to avoid a
 * circular import between them: the schema's `.transform()` needs to clamp a
 * margin string to the floor at parse time, and `documentConfig.ts` needs the
 * same arithmetic to compare a resolved margin against a template's default.
 * Neither of those two files imports the other; both import this.
 */

/** Inches represented by one unit of each length suffix `geometry` accepts. */
const INCHES_PER_UNIT: Record<string, number> = {
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  pt: 1 / 72
}

const LENGTH_RE = /^(\d+(?:\.\d+)?)(in|cm|mm|pt)$/

/** Parses a `document.margin`-shaped string. Returns `undefined` if it does
 * not match `DocumentConfigSchema`'s pattern — callers that reach here have
 * already gone through that regex, so this is belt and braces, not the
 * primary guard. */
export function parseLengthInches(raw: string): { inches: number; unit: string } | undefined {
  const match = LENGTH_RE.exec(raw.trim())
  if (!match) return undefined
  const [, numeral, unit] = match
  return { inches: Number(numeral) * INCHES_PER_UNIT[unit], unit }
}

/** The external feedback's universal rule, and the floor `document.margin`
 * clamps to. Also the value F2's geometry gate asserts against. */
export const MARGIN_FLOOR_IN = 0.5

/**
 * Clamps a margin string to the `0.5in` floor, silently — an agent tuning for
 * length should not get a validation failure it cannot interpret.
 *
 * The floor is re-expressed in the caller's own unit rather than switched to
 * inches, so `margin: '2mm'` clamps to a millimeter value, not a sudden unit
 * change the caller didn't ask for.
 */
export function clampMarginFloor(raw: string): string {
  const parsed = parseLengthInches(raw)
  if (!parsed || parsed.inches >= MARGIN_FLOOR_IN) return raw

  const floorInUnit = MARGIN_FLOOR_IN / INCHES_PER_UNIT[parsed.unit]
  // Round to 4 decimal places and drop trailing zeros, so '1in' clamps to
  // '1in' rather than growing spurious precision, while '2mm' still reads as
  // '12.7mm' rather than '12.700000000000001mm'.
  const rounded = Math.round(floorInUnit * 10000) / 10000
  return `${rounded}${parsed.unit}`
}
