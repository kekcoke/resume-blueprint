import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks } from './profiles.js'
import { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics) {
    if (!basics) {
      return ''
    }

    const { name, label, summary, email, phone, location, website, profiles } =
      basics
    const address = location?.address || ''
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    // The job title gets its own line rather than joining the contact run. A
    // parser reads the line under the name as the candidate's title; buried in
    // a `$\cdot$`-separated list it reads as one more contact detail.
    const lines = [
      name ? `{\\Huge \\scshape {${name}}}` : '',
      label ? `{\\large \\scshape ${label}}` : '',
      [address, email, phone, websiteLine, ...profileLinks(profiles)]
        .filter(Boolean)
        .join(' $\\cdot$ ')
    ].filter(Boolean)

    const header = lines.join('\\\\\n  ') + (lines.length > 1 ? '\\\\' : '')

    const summaryBlock = summary
      ? stripIndent`
          \\vspace{-2mm}
          ${summary}
          \\vspace{2mm}
        `
      : ''

    return stripIndent`
      %==== Profile ====%
      \\vspace*{-10pt}
      \\begin{center}
        ${header}
      \\end{center}
      ${summaryBlock}
    `
  },

  educationSection(education, heading) {
    if (!education) {
      return ''
    }

    return source`
      %==== Education ====%
      \\header{${heading || 'Education'}}
      ${education.map((school) => {
        const {
          institution,
          location,
          studyType,
          area,
          score,
          startDate,
          endDate
        } = school

        let line1 = ''
        let line2 = ''

        if (institution) {
          line1 += `\\textbf{${institution}}`
        }

        if (location) {
          line1 += `\\hfill ${location}`
        }

        if (studyType) {
          line2 += studyType
        }

        if (area) {
          line2 += studyType ? ` ${area}` : `Degree in ${area}`
        }

        if (score) {
          line2 += ` \\textit{GPA: ${score}}`
        }

        if (startDate || endDate) {
          const gradLine = `${startDate || ''} - ${endDate || ''}`
          line2 += line2 ? ` \\hfill ${gradLine}` : gradLine
        }

        if (line1) {
          line1 += '\\\\'
        }

        if (line2) {
          line2 += '\\\\'
        }

        return stripIndent`
          ${line1}
          ${line2.trim()}
          \\vspace{2mm}
        `
      })}
    `
  },

  workSection(work, heading) {
    if (!work) {
      return ''
    }

    return source`
      %==== Experience ====%
      \\header{${heading || 'Experience'}}
      \\vspace{1mm}

      ${work.map((job) => {
        const { name, position, location, startDate, endDate, summary, highlights } =
          job

        let line1 = ''
        let line2 = ''
        let summaryLine = ''
        let highlightLines = ''

        if (name) {
          line1 += `\\textbf{${name}}`
        }

        if (location) {
          line1 += ` \\hfill ${location}`
        }

        if (position) {
          line2 += `\\textit{${position}}`
        }

        if (startDate && endDate) {
          line2 += ` \\hfill ${startDate} - ${endDate}`
        } else if (startDate) {
          line2 += ` \\hfill ${startDate} - Present`
        } else if (endDate) {
          line2 += ` \\hfill ${endDate}`
        }

        if (line1) line1 += '\\\\'
        if (line2) line2 += '\\\\'

        if (summary) {
          summaryLine = `${summary}\\\\`
        }

        if (highlights) {
          highlightLines = source`
              \\vspace{-1mm}
              \\begin{itemize} \\itemsep 1pt
                ${highlights.map((highlight) => `\\item ${highlight}`)}
              \\end{itemize}
            `
        }

        return stripIndent`
          ${line1}
          ${line2}
          ${summaryLine}
          ${highlightLines}
        `
      })}
    `
  },

  skillsSection(skills, heading) {
    if (!skills) {
      return ''
    }

    // Both columns are p-columns so they wrap. An 'l' column typesets its cell on
    // one unbreakable line, which for a real skill list means the tail runs off
    // the right edge of the page and is simply gone — no warning, no error.
    return source`
      \\header{${heading || 'Skills'}}
      \\begin{tabular}{@{}p{7em}@{\\hspace{1em}}p{\\dimexpr\\linewidth-8em\\relax}@{}}
      ${skills.map((skill) => {
        const { name = 'Misc', keywords = [] } = skill
        return `${name}: & ${keywords.join(', ')} \\\\`
      })}
      \\end{tabular}
      \\vspace{2mm}
    `
  },

  projectsSection(projects, heading) {
    if (!projects) {
      return ''
    }

    return source`
      \\header{${heading || 'Projects'}}
      ${projects.map((project) => {
        if (Object.keys(project).length === 0) {
          return ''
        }

        const { name, description, keywords, url } = project

        let line1 = ''
        let line2 = description || ''

        if (name) {
          line1 += `{\\textbf{${name}}}`
        }

        if (keywords) {
          line1 += ` {\\sl ${keywords.join(', ')}} `
        }

        if (url) {
          line1 += `\\hfill \\href{${url}}{${url}}`
        }

        if (line1) {
          line1 += '\\\\'
        }

        if (line2) {
          line2 += '\\\\'
        }

        return stripIndent`
          ${line1}
          ${line2}
          \\vspace*{2mm}
        `
      })}
    `
  },

  awardsSection(awards, heading) {
    if (!awards) {
      return ''
    }

    return source`
      \\header{${heading || 'Awards'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        let line1 = ''
        let line2 = summary || ''

        if (title) {
          line1 += `\\textbf{${title}}`
        }

        if (awarder) {
          line1 += ` \\hfill ${awarder}`
        }

        if (date) {
          line2 += ` \\hfill ${date}`
        }

        if (line1) line1 += '\\\\'
        if (line2) line2 += '\\\\'

        return stripIndent`
          ${line1}
          ${line2}
          \\vspace*{2mm}
        `
      })}
    `
  },

  resumeHeader() {
    return stripIndent`
      %\\renewcommand{\\encodingdefault}{cg}
      %\\renewcommand{\\rmdefault}{lgrcmr}

      \\def\\bull{\\vrule height 0.8ex width .7ex depth -.1ex }

      % DEFINITIONS FOR RESUME %%%%%%%%%%%%%%%%%%%%%%%

      \\newcommand{\\area} [2] {
          \\vspace*{-9pt}
          \\begin{verse}
              \\textbf{#1}   #2
          \\end{verse}
      }

      \\newcommand{\\lineunder} {
          \\vspace*{-8pt} \\\\
          \\hspace*{-18pt} \\hrulefill \\\\
      }

      \\newcommand{\\header} [1] {
          {\\hspace*{-18pt}\\vspace*{6pt} \\textsc{#1}}
          \\vspace*{-6pt} \\lineunder
      }

      \\newcommand{\\employer} [3] {
          { \\textbf{#1} (#2)\\\\ \\underline{\\textbf{\\emph{#3}}}\\\\  }
      }

      \\newcommand{\\contact} [3] {
          \\vspace*{-10pt}
          \\begin{center}
              {\\Huge \\scshape {#1}}\\\\
              #2 \\\\ #3
          \\end{center}
          \\vspace*{-8pt}
      }

      \\newenvironment{achievements}{
          \\begin{list}
              {$\\bullet$}{\\topsep 0pt \\itemsep -2pt}}{\\vspace*{4pt}
          \\end{list}
      }

      \\newcommand{\\schoolwithcourses} [4] {
          \\textbf{#1} #2 $\\bullet$ #3\\\\
          #4 \\\\
          \\vspace*{5pt}
      }

      \\newcommand{\\school} [4] {
          \\textbf{#1} #2 $\\bullet$ #3\\\\
          #4 \\\\
      }
      % END RESUME DEFINITIONS %%%%%%%%%%%%%%%%%%%%%%%
    `
  }
}

function template1(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings } = values

  // TEMPLATE_DEFAULTS[1] is {paper: 'a4', fontSize: 10}, matching this class
  // line's original hardcoded '[a4paper]' (10pt is `article`'s size when no
  // option names one). Comparing against those exact constants — not just
  // checking "was document.paper set" — is what keeps the option list at
  // '[a4paper]' rather than growing a redundant '10pt' when the document
  // block is entirely default.
  const paperOption = config.paper === 'a4' ? 'a4paper' : 'letterpaper'
  const sizeOption = config.fontSize === 10 ? '' : `,${config.fontSize}pt`
  const classLine = `\\documentclass[${paperOption}${sizeOption}]{article}`

  // Margin is the one line in this template C4 permits to change even with
  // `document` omitted: TEMPLATE_DEFAULTS[1].margin is '1.1in', not this
  // template's old literal 0.8in — the F2 harness recorded 0.8in as breaching
  // the 0.5in floor once the header's \vspace*{-40pt}/\hspace*{-18pt} pull is
  // accounted for, and 1.1in is chosen to absorb that pull with room to spare.
  const geometryLine = `\\usepackage[left=${config.margin},right=${config.margin},bottom=${config.margin},top=${config.margin}]{geometry}`

  const extraLines = [
    // GLOBAL_DEFAULTS.lineSpacing is 1.0, which is LaTeX's own un-overridden
    // spacing — omitting \linespread entirely at that value is what keeps
    // this additive rather than replacing a line that never existed.
    config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
    // Additive rather than replacing '[hidelinks]{hyperref}' below: layering
    // \hypersetup after hyperref is already loaded needs no knowledge of
    // exactly how that line reads, and never fires when linkStyle is 'hidden'.
    config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : ''
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    ${classLine}
    \\usepackage{fullpage}
    \\usepackage{amsmath}
    \\usepackage{amssymb}
    \\usepackage{textcomp}
    \\usepackage[utf8]{inputenc}
    \\usepackage[T1]{fontenc}
    \\textheight=10in
    \\pagestyle{empty}
    \\raggedright
    ${geometryLine}
    ${['\\usepackage[hidelinks]{hyperref}', extraLines].filter(Boolean).join('\n')}
    ${generator.resumeHeader(config)}

    \\begin{document}
    \\vspace*{-40pt}

    ${values.sections
      .map((section) => {
        switch (section) {
          case 'profile':
            return generator.profileSection(values.basics)

          case 'education':
            return generator.educationSection(
              values.education,
              headings.education
            )

          case 'work':
            return generator.workSection(values.work, headings.work)

          case 'skills':
            return generator.skillsSection(values.skills, headings.skills)

          case 'projects':
            return generator.projectsSection(values.projects, headings.projects)

          case 'awards':
            return generator.awardsSection(values.awards, headings.awards)

          default:
            return ''
        }
      })
      .join('\n\n')}

    ${WHITESPACE}
    \\end{document}
  `
}

export default template1
