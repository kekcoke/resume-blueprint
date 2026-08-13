/**
 * Guards against unbounded recursion in store's `applyMergePatch`
 * (`packages/store/src/mergePatch.ts`), which recurses to the depth of the
 * caller-supplied `patch` object with no cap, and runs BEFORE
 * `parseBlueprint` validates anything. `packages/store` is out of scope for
 * Gate 2 (see docs/phase-2-plan-b.md), so this is mitigated at the MCP
 * boundary instead: reject deeply-nested patches before they ever reach
 * `store.patch`.
 *
 * Recurses itself, but bails out (throws) the moment `depth` exceeds
 * `maxDepth`, so it never walks anywhere near as deep as a malicious input
 * could be nested — a 1000-level-deep patch still only costs this function
 * ~33 stack frames before it throws and unwinds.
 */
export function assertReasonableDepth(value: unknown, maxDepth = 32): void {
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new Error('patch is nested too deeply')
    }
    if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) {
        walk(child, depth + 1)
      }
    }
  }
  walk(value, 0)
}
