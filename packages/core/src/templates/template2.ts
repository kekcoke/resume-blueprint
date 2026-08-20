import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { accentColorToTeX } from './documentConfig.js'
import { isFontSupported, georgiaFontspecTarget } from './fonts.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics, config) {
    if (!basics) {
      return ''
    }

    const { name, label, summary, email, phone, location = {}, website, profiles } =
      basics

    let nameLine = ''

    if (name) {
      const names = name.split(' ')
      let nameStart = ''
      let nameEnd = ''

      if (names.length === 1) {
        nameStart = names[0]
      } else {
        nameStart = names[0]
        nameEnd = names.slice(1, names.length).join(' ')
      }

      nameLine = `\\headerfirstnamestyle{${nameStart}} \\headerlastnamestyle{${nameEnd}} \\\\`
    }

    // awesome-cv.cls defines both of these for exactly this purpose: the stock
    // \makecvheader drives them from \position{} and \quote{}. This template
    // hand-rolls the header rather than calling \makecvheader, so it reaches for
    // the same style macros directly. The 6.0mm before the quote is the class's
    // own spacing (awesome-cv.cls \makecvheader), kept so the hand-rolled header
    // matches what the class was designed around.
    const positionLine = label ? `\\headerpositionstyle{${label}} \\\\` : ''
    // Leads with \\ so the quote starts its own line rather than running on from
    // the contact line, which is a single paragraph in horizontal mode.
    const quoteLine = summary
      ? `\\\\ \\vspace{6.0mm} \\headerquotestyle{${summary}}`
      : ''

    const emailLine = email ? `{\\faEnvelope\\ ${email}}` : ''
    const phoneLine = phone ? `{\\faMobile\\ ${phone}}` : ''
    const addressLine = location.address
      ? `{\\faMapMarker\\ ${location.address}}`
      : ''
    const websiteLine = website
      ? `{\\faLink\\ \\href{${website}}{${breakableUrl(website)}}}`
      : ''
    const profileLines = profileLinks(profiles).map(
      (link) => `{\\faLink\\ ${link}}`
    )
    const info = joinContactInfo(
      [emailLine, phoneLine, addressLine, websiteLine, ...profileLines],
      config.contactLayout,
      ' | '
    )

    return stripIndent`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %     Profile
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{center}
      ${nameLine}
      ${positionLine}
      \\vspace{2mm}
      ${info}
      ${quoteLine}
      \\end{center}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %     Education
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\cvsection{${heading || 'Education'}}
      \\begin{cventries}
      ${education.map((school) => {
        const {
          institution,
          location,
          area,
          studyType,
          score,
          startDate,
          endDate
        } = school

        let degreeLine

        if (studyType && area) {
          degreeLine = `${studyType} in ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
        }

        let dateRange

        if (startDate && endDate) {
          dateRange = `${startDate} – ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} – Present`
        } else {
          dateRange = endDate
        }

        return stripIndent`
          \\cventry
            {${degreeLine || ''}}
            {${institution || ''}}
            {${location || ''}}
            {${dateRange || ''}}
            {${score ? `GPA: ${score}` : ''}}
        `
      })}
      \\end{cventries}

      \\vspace{-2mm}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %     Experience
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\cvsection{${heading || 'Experience'}}
      \\begin{cventries}
      ${work.map((job) => {
        const { name, position, location, startDate, endDate, summary, highlights } =
          job

        let dateRange
        let dutyLines

        if (startDate && endDate) {
          dateRange = `${startDate} – ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} – Present`
        } else {
          dateRange = endDate
        }

        if (highlights?.length) {
          dutyLines = source`
            \\begin{cvitems}
              \\setlength\\itemsep{${config.bulletSpacing}pt}
              ${highlights.map((duty) => `\\item {${duty}}`)}
            \\end{cvitems}
            `
        }

        // \endgraf, not \par: awesome-cv defines \cventry with \newcommand*, so a
        // literal \par token while its arguments are being scanned aborts with
        // "Paragraph ended before \cventry was complete". \endgraf is \let to \par
        // and ends the paragraph just the same without tripping that check.
        //
        // The \vspace{4mm} cancels the \vspace{-4mm} that opens the cvitems
        // environment. Without it the bullet list is pulled up over the summary
        // and the two overprint each other.
        return stripIndent`
          \\cventry
            {${position || ''}}
            {${name || ''}}
            {${location || ''}}
            {${dateRange || ''}}
            {${summary ? `${summary}\\endgraf\\vspace{4mm}` : ''}${dutyLines}}
        `
      })}
      \\end{cventries}
    `
  },

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    // One row per category, category and keywords in the same run of text —
    // the previous two-column `tabular` put the label and its values in
    // separate cells, which a parser reads as two unrelated fragments (F5).
    // `cvitems` is the same bulleted-list macro this template's own
    // `workSection` already uses for highlights.
    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\cvsection{${heading || 'Skills'}}
      \\begin{cventries}
      \\cventry
      {}
      {\\begin{cvitems}
      \\setlength\\itemsep{${config.bulletSpacing}pt}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        const nameLine = name ? `\\textbf{${name}:} ` : ''

        return `\\item {${nameLine}${keywords.join(', ') || ''}}`
      })}
      \\end{cvitems}}
      {}
      {}
      {}
      \\end{cventries}

      \\vspace{-7mm}
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\cvsection{${heading || 'Projects'}}
      \\begin{cventries}
      ${projects.map((project) => {
        const { name, description, keywords = [], url } = project
        const urlLine = url ? `\\href{${url}}{${url}}` : ''

        return stripIndent`
          \\cventry
            {${description || ''}}
            {${name || ''}}
            {${keywords.join(', ') || ''}}
            {${urlLine}}
            {}

          \\vspace{-5mm}
        `
      })}
      \\end{cventries}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\cvsection{${heading || 'Awards'}}
      \\begin{cvhonors}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        return stripIndent`
          \\cvhonor
            {${title || ''}}
            {${summary || ''}}
            {${awarder || ''}}
            {${date || ''}}
        `
      })}
      \\end{cvhonors}
    `
  },

  resumeHeader(config) {
    const accentLine = config.accentColor
      ? `\\definecolor{awesome}{HTML}{${accentColorToTeX(config.accentColor)}}`
      : '\\colorlet{awesome}{awesome-red}'

    // awesome-cv.cls builds every visible run of text from one of five
    // \newfontfamily-declared commands, never \rmfamily/\sffamily — a
    // package-level font swap (the route templates 1/3/5/7/9/8 use) changes
    // nothing here. Only `georgia` is achievable (isFontSupported gates the
    // other four — see fonts.ts finding 4): \renewfontfamily redefines each
    // command in place, confirmed by compiling. This collapses the
    // light/thin vs. regular/medium weight distinction the class originally
    // drew between e.g. headerfont/headerfontlight — Gelasio has 4 weights,
    // not the 10 Roboto ships, an accepted simplification.
    const fontLines =
      config.fontFamily !== 'template' && isFontSupported(2, config.fontFamily)
        ? (() => {
            const target = georgiaFontspecTarget()
            return [
              `\\renewfontfamily\\headerfont${target}`,
              `\\renewfontfamily\\headerfontlight${target}`,
              `\\renewfontfamily\\footerfont${target}`,
              `\\renewfontfamily\\bodyfont${target}`,
              `\\renewfontfamily\\bodyfontlight${target}`
            ].join('\n')
          })()
        : ''

    const extraLines = [
      config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
      config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
      fontLines
    ]
      .filter(Boolean)
      .join('\n')

    return stripIndent`
    %!TEX TS-program = xelatex
    %!TEX encoding = UTF-8 Unicode
    % Awesome CV LaTeX Template
    %
    % This template has been downloaded from:
    % https://github.com/posquit0/Awesome-CV
    %
    % Author:
    % Claud D. Park <posquit0.bj@gmail.com>
    % http://www.posquit0.com
    %
    % Template license:
    % CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
    %


    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    %     Configuration
    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    %%% Themes: Awesome-CV
    \\documentclass[]{awesome-cv}
    \\usepackage{textcomp}
    %%% Override a directory location for fonts(default: 'fonts/')
    \\fontdir[fonts/]

    %%% Configure a directory location for sections
    \\newcommand*{\\sectiondir}{resume/}

    %%% Override color
    % Awesome Colors: awesome-emerald, awesome-skyblue, awesome-red, awesome-pink, awesome-orange
    %                 awesome-nephritis, awesome-concrete, awesome-darknight
    %% Color for highlight
    % Define your custom color if you don't like awesome colors
    ${accentLine}
    %\\definecolor{awesome}{HTML}{CA63A8}
    %% Colors for text
    %\\definecolor{darktext}{HTML}{414141}
    %\\definecolor{text}{HTML}{414141}
    %\\definecolor{graytext}{HTML}{414141}
    %\\definecolor{lighttext}{HTML}{414141}

    %%% Override a separator for social informations in header(default: ' | ')
    %\\headersocialsep[\\quad\\textbar\\quad]
    ${extraLines}
  `
  }
}

function template2(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // awesome-cv.cls owns its own page geometry (no TEMPLATE_DEFAULTS entry —
  // see documentConfig.ts), so margin and paper are only ever added, never
  // used to replace a line, and only when `document` actually set one:
  // gating on `values.document` (the sparse pre-resolution input) rather
  // than on `config` (always resolved, via GLOBAL_DEFAULTS, to *something*)
  // is what keeps this silent when the caller sent nothing.
  //
  // `\usepackage{geometry}` (no options) plus `\geometry{...}` to
  // reconfigure, not a second `\usepackage[...]{geometry}` — template4
  // confirmed by compiling it that a vendored class loading geometry
  // internally turns a second options-bearing load into a hard "Option
  // clash" error. A bare re-`\usepackage` never clashes, and `\geometry{}`
  // wins regardless of whether the class already loaded the package.
  const geometryOptions = [
    values.document.paper !== undefined ? (config.paper === 'a4' ? 'a4paper' : 'letterpaper') : '',
    values.document.margin !== undefined ? `margin=${config.margin}` : ''
  ].filter(Boolean)
  const geometryLines = geometryOptions.length
    ? ['\\usepackage{geometry}', `\\geometry{${geometryOptions.join(',')}}`]
    : []
  // Combined into one interpolation with resumeHeader's output, not appended
  // on its own line: resumeHeader() is immediately followed by
  // \begin{document} in the original with no blank line between them, and an
  // empty addition on its own line would insert one.
  const preamble = [generator.resumeHeader(config), ...geometryLines].filter(Boolean).join('\n')

  return stripIndent`
    ${preamble}
    \\begin{document}
    ${values.sections
      .map((section) => {
        switch (section) {
          case 'profile':
            return generator.profileSection(values.basics, config)

          case 'education':
            return generator.educationSection(
              values.education,
              headings.education,
              config
            )

          case 'work':
            return generator.workSection(values.work, headings.work, config)

          case 'skills':
            return generator.skillsSection(values.skills, headings.skills, config)

          case 'projects':
            return generator.projectsSection(values.projects, headings.projects, config)

          case 'awards':
            return generator.awardsSection(values.awards, headings.awards, config)

          default:
            return ''
        }
      })
      .join('\n')}
    ${WHITESPACE}
    \\end{document}
  `
}

export default template2
