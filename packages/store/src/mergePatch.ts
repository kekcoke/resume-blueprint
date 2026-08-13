/**
 * Applies an RFC 7386 JSON Merge Patch: objects are merged key by key, a `null`
 * value deletes the key, and any non-object patch (including arrays) replaces
 * the target wholesale.
 *
 * Pure function — no fs or git dependency — so it is trivially unit-testable
 * and reusable from `sectionAppend`/`sectionUpdate`/`sectionRemove`, which build
 * their patches as plain objects and run them through this same path.
 */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch
  }

  const base: Record<string, unknown> =
    target !== null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) {
      delete base[key]
    } else {
      base[key] = applyMergePatch(base[key], value)
    }
  }

  return base
}
