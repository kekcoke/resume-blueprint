import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as store from '@resume-blueprint/store'
import {
  parseBlueprint,
  blueprintToTex,
  renderBlueprint,
  isValidationError,
  formatValidationError,
  TEMPLATE_IDS
} from '@resume-blueprint/core'

import {
  ResumeListInput,
  ResumeGetInput,
  ResumeCreateInput,
  ResumePatchInput,
  ResumeSectionAppendInput,
  ResumeSectionUpdateInput,
  ResumeSectionRemoveInput,
  ResumeRemoveInput,
  ResumeValidateInput,
  ResumeRenderInput,
  ResumeTexInput,
  ResumeHistoryInput,
  ResumeDiffInput,
  ResumeRevertInput,
  ResumeTemplatesInput
} from './schemas.js'
import { toToolError } from './errors.js'
import { renderDir, renderPath, writeRenderFile, pruneOldRenders, countPages } from './render.js'

/** Actor recorded on every commit this server makes. */
const ACTOR = 'mcp'

/** Same env-var convention as store's `resolveHome` (not exported by the store
 * package): read `RESUME_BLUEPRINT_HOME` at call time, default `~/.resume-blueprint`. */
function resolveHome(): string {
  const raw = process.env.RESUME_BLUEPRINT_HOME
  return resolve(raw && raw.trim() ? raw : join(homedir(), '.resume-blueprint'))
}

function revText(rev: string): string {
  return rev.slice(0, 7)
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    'resume_list',
    {
      title: 'List blueprints',
      description: 'Lists every stored blueprint with its id, name, and last-modified revision.',
      inputSchema: ResumeListInput,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const blueprints = await store.list()
        const text = blueprints.length
          ? blueprints.map((b) => `${b.id}${b.name ? ` (${b.name})` : ''} @ ${revText(b.rev)}`).join('\n')
          : 'no blueprints stored'
        return {
          content: [{ type: 'text', text }],
          structuredContent: { blueprints }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_get',
    {
      title: 'Get blueprint',
      description: 'Fetches a stored blueprint and its current revision.',
      inputSchema: ResumeGetInput,
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      try {
        const { blueprint, rev } = await store.get(id)
        return {
          content: [{ type: 'text', text: `${id} @ ${revText(rev)}` }],
          structuredContent: { blueprint, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_create',
    {
      title: 'Create blueprint',
      description: 'Creates a new blueprint, optionally seeded with initial content.',
      inputSchema: ResumeCreateInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, blueprint }) => {
      try {
        const { rev } = await store.create(id, blueprint ?? {}, { actor: ACTOR })
        return {
          content: [{ type: 'text', text: `created "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_patch',
    {
      title: 'Patch blueprint',
      description: 'Applies an RFC 7386 JSON Merge Patch to a stored blueprint. A `null` value deletes a key.',
      inputSchema: ResumePatchInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, patch, expectedRev }) => {
      try {
        const { rev } = await store.patch(id, patch, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `patched "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_section_append',
    {
      title: 'Append section item',
      description: 'Appends an item to one of a blueprint\'s array sections (e.g. work, education, skills).',
      inputSchema: ResumeSectionAppendInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, section, item, expectedRev }) => {
      try {
        const { rev } = await store.sectionAppend(id, section, item, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `appended to "${section}" of "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_section_update',
    {
      title: 'Update section item',
      description: 'Replaces the item at a given index within one of a blueprint\'s array sections.',
      inputSchema: ResumeSectionUpdateInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, section, index, item, expectedRev }) => {
      try {
        const { rev } = await store.sectionUpdate(id, section, index, item, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `updated "${section}[${index}]" of "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_section_remove',
    {
      title: 'Remove section item',
      description: 'Removes the item at a given index from one of a blueprint\'s array sections.',
      inputSchema: ResumeSectionRemoveInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, section, index, expectedRev }) => {
      try {
        const { rev } = await store.sectionRemove(id, section, index, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `removed "${section}[${index}]" of "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_remove',
    {
      title: 'Remove blueprint',
      description: 'Deletes a stored blueprint entirely.',
      inputSchema: ResumeRemoveInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, expectedRev }) => {
      try {
        const { rev } = await store.remove(id, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `removed "${id}" @ ${revText(rev)}` }],
          structuredContent: { id, rev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_validate',
    {
      title: 'Validate blueprint',
      description: 'Validates a blueprint against the schema without storing or rendering it.',
      inputSchema: ResumeValidateInput,
      annotations: { readOnlyHint: true }
    },
    // Deliberately does not go through toToolError: reporting "invalid" is
    // this tool's successful outcome, not a tool failure, so isError stays
    // false either way. Only a non-validation error (unexpected) propagates
    // out to the SDK's own catch-all.
    async ({ blueprint }) => {
      try {
        parseBlueprint(blueprint)
      } catch (error) {
        if (!isValidationError(error)) throw error
        const errors = formatValidationError(error)
        return {
          content: [{ type: 'text', text: errors }],
          structuredContent: { valid: false, errors },
          isError: false
        }
      }
      return {
        content: [{ type: 'text', text: 'blueprint is valid' }],
        structuredContent: { valid: true }
      }
    }
  )

  server.registerTool(
    'resume_render',
    {
      title: 'Render blueprint to PDF',
      description:
        'Renders a stored blueprint to a typeset PDF, writing it to disk under $RESUME_BLUEPRINT_HOME/renders ' +
        'and returning its path, page count, and byte size (never the PDF bytes themselves).',
      inputSchema: ResumeRenderInput,
      // Writes a file — a real side effect, unlike resume_tex.
      annotations: { readOnlyHint: false }
    },
    async ({ id, template, timeoutMs }) => {
      try {
        const { blueprint, rev } = await store.get(id)
        const effectiveTemplate = template ?? blueprint.selectedTemplate
        const input = template === undefined ? blueprint : { ...blueprint, selectedTemplate: template }

        const pdf = await renderBlueprint(input, { timeoutMs })

        const home = resolveHome()
        const path = join(renderDir(home), renderPath(id, rev, effectiveTemplate))
        await writeRenderFile(pdf, path)
        await pruneOldRenders(home, id)

        const pageCount = countPages(pdf)
        const byteSize = pdf.length
        const kb = Math.round(byteSize / 1024)

        return {
          content: [
            { type: 'text', text: `${pageCount} page${pageCount === 1 ? '' : 's'}, ${kb}KB, at ${path}` }
          ],
          structuredContent: { path, pageCount, byteSize }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_tex',
    {
      title: 'Get LaTeX source',
      description: 'Renders a stored blueprint to its LaTeX source, without compiling it to PDF.',
      inputSchema: ResumeTexInput,
      annotations: { readOnlyHint: true }
    },
    async ({ id, template }) => {
      try {
        const { blueprint } = await store.get(id)
        const input = template === undefined ? blueprint : { ...blueprint, selectedTemplate: template }
        const { texDoc } = blueprintToTex(input)
        return {
          content: [{ type: 'text', text: texDoc }],
          structuredContent: { texDoc }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_history',
    {
      title: 'Blueprint history',
      description: 'Lists a blueprint\'s revisions, newest first.',
      inputSchema: ResumeHistoryInput,
      annotations: { readOnlyHint: true }
    },
    async ({ id, limit }) => {
      try {
        const commits = await store.history(id, limit)
        const text = commits.map((c) => `${revText(c.rev)}  ${c.date}  ${c.message}`).join('\n')
        return {
          content: [{ type: 'text', text }],
          structuredContent: { commits }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_diff',
    {
      title: 'Diff revisions',
      description: 'Shows the unified diff between two revisions of a blueprint (revB defaults to the current revision).',
      inputSchema: ResumeDiffInput,
      annotations: { readOnlyHint: true }
    },
    async ({ id, revA, revB }) => {
      try {
        const diffText = await store.diff(id, revA, revB)
        return {
          content: [{ type: 'text', text: diffText || '(no differences)' }],
          structuredContent: { diff: diffText }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_revert',
    {
      title: 'Revert blueprint',
      description: 'Restores a blueprint to its content at a prior revision, as a new commit.',
      inputSchema: ResumeRevertInput,
      annotations: { readOnlyHint: false }
    },
    async ({ id, rev, expectedRev }) => {
      try {
        const { rev: newRev } = await store.revert(id, rev, { actor: ACTOR, expectedRev })
        return {
          content: [{ type: 'text', text: `reverted "${id}" to ${revText(rev)}, now @ ${revText(newRev)}` }],
          structuredContent: { id, rev: newRev }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )

  server.registerTool(
    'resume_templates',
    {
      title: 'List templates',
      description: 'Lists the available template ids.',
      inputSchema: ResumeTemplatesInput,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        return {
          content: [{ type: 'text', text: TEMPLATE_IDS.join(', ') }],
          structuredContent: { templates: TEMPLATE_IDS }
        }
      } catch (error) {
        return toToolError(error)
      }
    }
  )
}
