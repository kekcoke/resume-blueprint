/** Store-local types. Not exported by `@resume-blueprint/core`. */

export interface BlueprintSummary {
  id: string
  name?: string
  /** ISO 8601 timestamp of the blueprint's most recent commit. */
  updatedAt: string
  rev: string
}

export interface Commit {
  rev: string
  /** ISO 8601 commit date. */
  date: string
  message: string
}
