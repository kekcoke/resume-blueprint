# resume-blueprint

A local-first resume service: a validated JSON blueprint goes in, a typeset PDF comes out.

Built by extracting the nine LaTeX template generators from the retired
[resumake.io](https://github.com/saadq/resumake.io) project and rebuilding them as a
pure, UI-free package that agents and workflows can call.

## Status

**Phase 1 complete.** The core package and CLI work end to end; all nine templates
compile. The MCP server, HTTP adapter, and versioned blueprint store are Phase 2.

## Requirements

- Node.js >= 20
- [Tectonic](https://tectonic-typesetting.github.io/) on `PATH` — `brew install tectonic`

Tectonic is used instead of a full TeX Live install because it is a single ~30MB binary
that fetches only the packages a document actually needs. The first render of a given
template downloads those packages and caches them; later renders are offline and take
well under a second.

## Quick start

```bash
npm install
npm run build

node packages/cli/dist/index.js render fixtures/sample.json -t 3 -o ada.pdf
```

## CLI

```
resume render <blueprint.json> [-t N] [-o out.pdf]   Render to PDF
resume tex    <blueprint.json> [-t N] [-o out.tex]   Emit LaTeX source
resume validate <blueprint.json>                     Validate, with readable errors
resume list-templates                                List template IDs
```

Pass `-` as the path to read the blueprint from stdin. Without `-o`, output goes to stdout.

## Library

```ts
import { renderBlueprint, blueprintToTex, parseBlueprint } from '@resume-blueprint/core'

const pdf = await renderBlueprint(blueprint)   // Buffer
const { texDoc } = blueprintToTex(blueprint)   // LaTeX source
```

`renderBlueprint` and `blueprintToTex` both validate and sanitize before touching a
template. Prefer them over calling `getTemplateData` directly — they are what guarantee
the document handed to the engine has been escaped.

## The blueprint format

[JSON Resume](https://jsonresume.org) plus a few extensions the templates consume.
See `fixtures/sample.json`. Every field is optional; validation checks structure and
types, while blank values are pruned rather than rejected, so an agent can build a
blueprint up incrementally.

`work[].company` is accepted as an alias for `work[].name`.

## Architecture

```
packages/core/    schema, sanitizer, 9 templates, Tectonic renderer — no I/O it was not handed
packages/cli/     thin argv wrapper over core
fixtures/         sample + adversarial blueprints, golden .tex snapshots
```

The rule that keeps this extensible: **core knows nothing about MCP, HTTP, or argv.**
Every interface is a thin adapter over the same call path.

## Security

Blueprint content may be written by an LLM or scraped from a job posting, and it is
interpolated into a document handed to a TeX engine. TeX is a programming language:
unescaped, `\input{/etc/passwd}` reads a local file into the rendered PDF and
`\write18{...}` shells out.

Two layers address this:

1. **`sanitize.ts`** escapes every LaTeX special character in a single pass, so injected
   commands typeset as visible literal text rather than executing. URLs get separate
   handling — validated through the URL parser, restricted to http/https/mailto, and
   escaped so they stay valid in both `\href` arguments.
2. **The renderer passes `--untrusted`**, which disables shell-escape and other
   known-insecure engine features.

`fixtures/injection.json` exercises this, and the test suite asserts that no payload
survives into the generated TeX and that nothing executes during a real compile.

## Tests

```bash
npm test
```

Covers the sanitizer, golden `.tex` snapshots for all nine templates, a real compile of
each with page-count assertions, and the adversarial fixture. After an intentional change
to template output:

```bash
npm run test:update-golden --workspace @resume-blueprint/core
```

## Notes on the extraction

Fixed while porting, all present in the upstream `v2` branch:

- **Employer names never rendered.** The form wrote `work[].company`; all nine templates
  read `work[].name`. Now aliased in the schema and asserted in tests.
- **No input sanitization existed.** The 2022 server had it; the 2024 rewrite dropped it,
  leaving only `// TODO: validate using Zod` comments.
- **template9 used `\textheight=700px`.** `px` is a pdfTeX-only unit that XeTeX-derived
  engines reject. Changed to the identical `700bp`.
- **template9 enabled microtype font expansion**, which is also pdfTeX-only. Protrusion
  stays on; expansion is off.
- **template7 vendored a partial, 2013-era moderncv.** Staging only some of the package
  meant LaTeX resolved the rest from Tectonic's bundle and hit a version clash. The
  bundle now supplies moderncv in full.

Known gap: `work[].summary` is valid JSON Resume and is accepted and preserved, but none
of the nine templates render it. Use `highlights` for content that must appear.

## Credits

The LaTeX templates come from resumake.io by Saad Quadri (MIT), which in turn credits
Rensselaer CDC, Byungjin Park, Scott Clark, Debarghya Das, Xavier Danaux, Ratul Saha,
Daniil Belyakov, and Frits Wenneker.

## License

MIT
