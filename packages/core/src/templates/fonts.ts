import type { TEMPLATE_IDS } from '../schema.js'
import type { ResolvedDocumentConfig } from './documentConfig.js'

/**
 * F4 — font families. `document.fontFamily`'s five real values, mapped to the
 * LaTeX mechanism that actually renders them. `'template'` (the default, a
 * no-op meaning "whatever this template already hardcodes") never reaches
 * this file — every call site here guards on it first.
 *
 * Findings below are from a throwaway spike compiled directly against
 * Tectonic 0.17.0 with `--untrusted` (never committed as `.tex` files) before
 * any template source was touched, per docs/next-features.md's F4 scope
 * ("Step 1 is a spike, not code"):
 *
 * 1. `carlito`/`arimo`/`tgheros` load cleanly via `\usepackage{<pkg>}` +
 *    `\renewcommand{\familydefault}{\sfdefault}` on every template's real
 *    preamble, including `mcdowellcv.cls` (template 8) despite it already
 *    loading `fontspec` — the two coexist fine as long as nothing calls
 *    `\setmainfont` (it doesn't). `\scshape` (used in template1's name
 *    header) degrades cleanly for all three — no undefined-shape warnings.
 *    `carlito` needed one correction found only by extracting the compiled
 *    PDF, not by reading a compile log: its default old-style figures
 *    (`+onum`) render — they visibly take up space in the PDF — but produce
 *    NO extractable digits at all via `pdftotext` (not garbled, not
 *    private-use glyphs, just silently absent, and text after them
 *    reshuffles order). A resume's phone number or GPA would vanish from any
 *    ATS text layer. `\usepackage[lining]{carlito}` (a real, documented
 *    package option) switches to lining figures and fixes it completely —
 *    confirmed extracting clean. `arimo` has no oldstyle-figure option at
 *    all (lining-only by default) and `tgheros` (classical Type1/PSNFSS,
 *    not an OpenType-feature route) never had the problem — both extract
 *    clean with no option needed.
 * 2. `ebgaramond` bare `\usepackage{ebgaramond}` compiles, but its
 *    `EBGaramond-Initials.otf` drop-cap font is loaded unconditionally
 *    (`\newfontface\initials{EBGaramond-Initials}`) and emits a "no space
 *    character (U+0020)" warning at load time — cosmetic-only (compile still
 *    succeeds), but avoidable: the `type1` package option switches to the
 *    classical Type1/PSNFSS route (`\fontfamily{EBGaramondInitials-TLF}`,
 *    lazily selected rather than eagerly loaded), which never triggers the
 *    warning. Use `\usepackage[type1]{ebgaramond}`. Garamond does not reset
 *    `\familydefault` — it's a serif substitute for a serif default.
 * 3. Gelasio (vendored as 4 static TTFs — see GELASIO_FILES) loads cleanly
 *    via `\setmainfont[Path=fonts/,UprightFont=*-Regular,...]{Gelasio}`
 *    everywhere tried: an NFSS-route preamble with `fontspec` freshly added,
 *    `mcdowellcv.cls` directly, and via `\renewfontfamily` redefining
 *    `awesome-cv.cls`'s (template 2) existing `\newfontfamily` commands.
 *    `pdftotext` extraction stayed clean in every case. Small-caps requests
 *    against Gelasio (it has no true SC variant) degrade to a non-fatal
 *    `LaTeX Font Warning: ... undefined, using .../n instead` — cosmetic,
 *    not a missing-text defect.
 * 4. THE DECISION POINT: `\renewfontfamily\headerfont{Carlito}` (no `Path=`)
 *    on `awesome-cv.cls` FAILS — `Package fontspec Error: The font "Carlito"
 *    cannot be found.` Tectonic's `--untrusted` sandbox disables system-font
 *    lookup, and the font files backing the NFSS packages aren't exposed to
 *    fontspec's by-name resolution outside those packages' own `.sty`
 *    machinery. So `calibri`/`arial`/`helvetica`/`garamond` are NOT
 *    achievable on templates 2, 4, and 6, whose visible text is built from
 *    literal `\newfontfamily`/`\fontspec` calls that bypass `\rmfamily`/
 *    `\sffamily` entirely (unlike template 8, which loads `fontspec` but
 *    never calls it — see finding 1 — so the NFSS packages work there
 *    unmodified). Vendoring those four families' files too, the same way
 *    Gelasio is vendored, would close the gap but is out of scope for this
 *    feature. See UNSUPPORTED_FONTS.
 * 5. The indirection-macro pattern template 4 (and 6) need for `georgia`
 *    (replace a literal font name inside a vendored macro body with a
 *    `\newcommand`, override it with `\renewcommand*` from the generator)
 *    works: fontspec accepts an expandable macro as its font-name argument.
 */

export type FontFamily = NonNullable<ResolvedDocumentConfig['fontFamily']>
type TemplateId = (typeof TEMPLATE_IDS)[number]

type NfssSpec = {
  mechanism: 'nfss'
  package: 'carlito' | 'arimo' | 'tgheros' | 'ebgaramond'
  packageOptions?: string
  resetFamilyDefault: boolean
}

type VendoredFontspecSpec = {
  mechanism: 'fontspec-vendored'
  family: 'Gelasio'
  files: readonly string[]
}

type FontSpec = NfssSpec | VendoredFontspecSpec

/** Paths relative to ASSET_ROOT (`packages/core/assets/templates`), for `opts.fonts`. */
export const GELASIO_FILES: readonly string[] = [
  'fonts/gelasio/Gelasio-Regular.ttf',
  'fonts/gelasio/Gelasio-Bold.ttf',
  'fonts/gelasio/Gelasio-Italic.ttf',
  'fonts/gelasio/Gelasio-BoldItalic.ttf'
]

/** The `\setmainfont`/`\newfontfamily`/`\renewfontfamily` bracket options for Gelasio. */
const GELASIO_FONTSPEC_OPTIONS =
  'Path=fonts/,UprightFont=*-Regular,ItalicFont=*-Italic,BoldFont=*-Bold,BoldItalicFont=*-BoldItalic'

export const FONT_FAMILIES: Record<
  Exclude<FontFamily, 'template'>,
  FontSpec
> = {
  calibri: {
    mechanism: 'nfss',
    package: 'carlito',
    packageOptions: 'lining',
    resetFamilyDefault: true
  },
  arial: { mechanism: 'nfss', package: 'arimo', resetFamilyDefault: true },
  helvetica: {
    mechanism: 'nfss',
    package: 'tgheros',
    resetFamilyDefault: true
  },
  garamond: {
    mechanism: 'nfss',
    package: 'ebgaramond',
    packageOptions: 'type1',
    resetFamilyDefault: false
  },
  georgia: {
    mechanism: 'fontspec-vendored',
    family: 'Gelasio',
    files: GELASIO_FILES
  }
}

/**
 * Combos that don't work — the override is a silent no-op there, identical
 * to `fontFamily: 'template'`, rather than a broken compile. See spike
 * finding 4: templates 2, 4, and 6 build their visible text from literal
 * per-macro `\newfontfamily`/`\fontspec` calls rather than `\rmfamily`/
 * `\sffamily`, and the four NFSS-backed families can't be resolved by
 * fontspec's name lookup under Tectonic's sandbox. `georgia` is unaffected
 * (always `Path=`-based) and works on all nine templates, including these
 * three. Template 8 is NOT here — despite also loading `fontspec` in its
 * vendored class, it never calls `\setmainfont`, so all five families work
 * there via the plain NFSS route (finding 1).
 */
export const UNSUPPORTED_FONTS: Partial<
  Record<TemplateId, readonly FontFamily[]>
> = {
  2: ['calibri', 'arial', 'helvetica', 'garamond'],
  4: ['calibri', 'arial', 'helvetica', 'garamond'],
  6: ['calibri', 'arial', 'helvetica', 'garamond']
}

export function isFontSupported(id: TemplateId, family: FontFamily): boolean {
  return family !== 'template' && !UNSUPPORTED_FONTS[id]?.includes(family)
}

/**
 * Preamble lines for a template that selects its font through plain NFSS
 * (`\rmfamily`/`\sffamily`, never a per-macro `\fontspec`/`\newfontfamily`
 * call): a package swap for the four bundle-resolved families, or a
 * freshly-loaded fontspec + `Path=` override for georgia. Covers templates
 * 1, 3, 5, 7, 9 (never loaded fontspec) and template 8 (loads fontspec but
 * never calls it, so re-declaring the package here and adding a
 * `\setmainfont` is exactly as safe as on a template that never touched it —
 * see spike finding 1). Empty string for `'template'` or an unsupported
 * combo (never actually reached today — every family is supported on every
 * template this function is called for).
 */
export function nfssFontPreamble(
  id: TemplateId,
  config: ResolvedDocumentConfig
): string {
  const { fontFamily } = config
  if (fontFamily === 'template' || !isFontSupported(id, fontFamily)) return ''

  const spec = FONT_FAMILIES[fontFamily]
  if (spec.mechanism === 'nfss') {
    const opt = spec.packageOptions ? `[${spec.packageOptions}]` : ''
    return [
      `\\usepackage${opt}{${spec.package}}`,
      spec.resetFamilyDefault
        ? '\\renewcommand{\\familydefault}{\\sfdefault}'
        : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    '\\usepackage{fontspec}',
    `\\setmainfont[${GELASIO_FONTSPEC_OPTIONS}]{${spec.family}}`
  ].join('\n')
}

/**
 * The bracketed-options-plus-braced-name suffix for declaring a NEW
 * fontspec family as Gelasio, e.g.
 * `\renewfontfamily\headerfont${georgiaFontspecTarget()}` (template 2) or
 * `\setmainfont${georgiaFontspecTarget()}` — sites that support the
 * `UprightFont=`/`ItalicFont=`/`BoldFont=`/`BoldItalicFont=` wildcard
 * mapping directly. NOT for template 4's or 6's indirection macros (see
 * `georgiaFileBasename`) — those hold a bare font-file name referenced
 * inside an already-bracketed `\fontspec[Path=fonts/]{...}` call, where a
 * second `[...]` would corrupt `\renewcommand`'s own optional-argument-count
 * syntax. Always Gelasio: it's the only family `isFontSupported` allows on
 * 2, 4, and 6.
 */
export function georgiaFontspecTarget(): string {
  return `[${GELASIO_FONTSPEC_OPTIONS}]{Gelasio}`
}

/**
 * A single loadable Gelasio file basename, for indirection macros that hold
 * only a bare font name (template 4's `\rbextralight`/`\rbregular`/
 * `\rbmedium`, template 6's per-call-site literals) — every call site that
 * uses them already supplies its own fixed `[Path=fonts/]`, mirroring how
 * the original Raleway/Montserrat/CrimsonText names were single flat files
 * with no bold/italic wildcard mapping of their own. Collapses onto one of
 * Gelasio's two core weights rather than the four full family weights
 * `georgiaFontspecTarget` maps — the same weight-collapsing trade-off
 * already accepted for template 2.
 */
export function georgiaFileBasename(
  weight: 'regular' | 'bold' = 'regular'
): string {
  return weight === 'bold' ? 'Gelasio-Bold' : 'Gelasio-Regular'
}

/** Font files to stage via `opts.fonts`, empty unless `fontFamily: 'georgia'`. */
export function fontFiles(config: ResolvedDocumentConfig): readonly string[] {
  return config.fontFamily === 'georgia' ? GELASIO_FILES : []
}
