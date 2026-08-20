import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { accentColorToTeX } from './documentConfig.js'
import { nfssFontPreamble } from './fonts.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics, config) {
    if (!basics) {
      return ''
    }

    const { name, label, summary, email, phone, location = {}, website, profiles } =
      basics
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    const info = joinContactInfo(
      [email, phone, location.address, websiteLine, ...profileLinks(profiles)],
      config.contactLayout,
      ' | '
    )

    // Both sit below the header rule rather than inside the tabular: its cells
    // are single-line, so a job title or a paragraph put in one would run off
    // the right edge instead of wrapping.
    const labelLine = label ? `\\noindent{\\large \\textit{${label}}}\\par` : ''
    const summaryBlock = summary ? `\n${summary}\\par\\vspace{4pt}` : ''

    // The original crammed the name and the whole contact run into one
    // \\begin{tabular*}{7in}{l...r}. \\textwidth is set to exactly 7in in this
    // template's preamble, so there was zero slack, and neither an `l` nor an `r`
    // cell wraps — a long contact line ran off the page and a long name collided
    // with it. Stacking them lets both wrap, and puts the name on a line of its
    // own where a parser expects to find it.
    return stripIndent`
      \\noindent{\\Large \\textbf{${name || ''}}}\\par
      ${labelLine}
      \\noindent{\\textit{${info}}}\\par
      ${summaryBlock}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Education'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]

      ${education.map((school) => {
        const {
          institution = '',
          location = '',
          studyType = '',
          area = '',
          score = '',
          startDate = '',
          endDate = ''
        } = school

        let formattedLocation = ''

        if (location) {
          formattedLocation = location + '\\\\'
        }

        let degreeLine = ''

        if (studyType && area) {
          degreeLine = `${studyType} ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
        }

        if (score) {
          degreeLine += degreeLine ? `, GPA: ${score}` : `GPA: ${score}`
        }

        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        return stripIndent`
          \\item[]
            \\school
              {${institution || ''}}
              {${formattedLocation || ''}}
              {${degreeLine}}
              {${dateRange || ''}}
        `
      })}

      \\end{itemize}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Experience'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]
      ${work.map((job) => {
        const { name, position, location, startDate, endDate, summary, highlights } =
          job

        let dateRange
        let dutyLines

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (highlights?.length) {
          dutyLines = source`
            \\begin{itemize}[itemsep=${config.bulletSpacing}pt]
              ${highlights.map((duty) => `\\item ${duty}`)}
            \\end{itemize}
            `
        }

        const summaryLine = summary ? `\\par ${summary}` : ''

        return stripIndent`
          \\item[]
            \\job
              {${name || ''}}
              {${location || ''}}
              {${position || ''}}
              {${dateRange || ''}}
              ${summaryLine}
              ${dutyLines}
        `
      })}
      \\end{itemize}
    `
  },

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Skills'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]
      ${skills.map((skill) => {
        const { name = '', keywords = [] } = skill
        return `\\item[] \\skill{${name}}{${keywords.join(', ')}}`
      })}
      \\end{itemize}
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Projects'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]
      ${projects.map((project) => {
        const { name = '', description = '', keywords = [], url = '' } = project

        const descriptionWithNewline = description
          ? `\\\\${description}`
          : description
        const urlLine = url ? `\\href{${url}}{${url}}` : ''

        return stripIndent`
          \\item[]
            \\project
              {${name}}
              {${keywords.join(', ')}}
              {${urlLine}}
              {${descriptionWithNewline}}
        `
      })}
      \\end{itemize}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Awards'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]
      ${awards.map((award) => {
        const { title = '', summary = '', date = '', awarder = '' } = award

        const summaryWithNewline = summary ? `\\\\${summary}` : summary

        return stripIndent`
          \\item[]
            \\award
              {${title}}
              {${date}}
              {${awarder}}
              {${summaryWithNewline}}
        `
      })}
      \\end{itemize}
    `
  },

  certificatesSection(certificates, heading, config) {
    if (!certificates) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\resheading{${heading || 'Certificates'}}
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\begin{itemize}[leftmargin=*, itemsep=${config.bulletSpacing}pt]
      ${certificates.map((cert) => `\\item[] ${certificateLine(cert)}`)}
      \\end{itemize}
    `
  },

  resumeHeader(config) {
    // TEMPLATE_DEFAULTS[3] is {paper: 'letter', fontSize: 11}, matching this
    // class line's current literal '[11pt]' (no page-size option today means
    // letterpaper, article's own default). Comparing against those exact
    // constants keeps the option list unchanged unless a value actually
    // differs from what's already hardcoded.
    const paperOption = config.paper === 'a4' ? 'a4paper,' : ''
    const sizeOption = config.fontSize === 11 ? '11pt' : `${config.fontSize}pt`
    const classLine = `\\documentclass[${paperOption}${sizeOption}]{article}`

    // Only the inner, more prominent bar color (shadecolorB) stands in for
    // "accent" here — the outer border (shadecolor) is structural framing,
    // not a theme color, and stays gray.
    const shadecolorBLine = config.accentColor
      ? `\\definecolor{shadecolorB}{HTML}{${accentColorToTeX(config.accentColor)}}  % Inner background color of title bars`
      : '\\definecolor{shadecolorB}{gray}{0.93}  % Inner background color of title bars'

    const extraLines = [
      config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
      config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
      nfssFontPreamble(3, config)
    ]
      .filter(Boolean)
      .join('\n')

    return stripIndent`
      % (c) 2002 Matthew Boedicker <mboedick@mboedick.org> (original author) http://mboedick.org
      % (c) 2003-2007 David J. Grant <davidgrant-at-gmail.com> http://www.davidgrant.ca
      % (c) 2008 Nathaniel Johnston <nathaniel@nathanieljohnston.com> http://www.nathanieljohnston.com
      %
      % (c) 2012 Scott Clark <sc932@cornell.edu> cam.cornell.edu/~sc932
      %
      %This work is licensed under the Creative Commons Attribution-Noncommercial-Share Alike 2.5 License. To view a copy of this license, visit http://creativecommons.org/licenses/by-nc-sa/2.5/ or send a letter to Creative Commons, 543 Howard Street, 5th Floor, San Francisco, California, 94105, USA.

      ${classLine}
      \\newlength{\\outerbordwidth}
      \\pagestyle{empty}
      \\raggedbottom
      \\raggedright
      \\usepackage[svgnames]{xcolor}
      \\usepackage{framed}
      \\usepackage{tocloft}
      \\usepackage{enumitem}
      \\usepackage{textcomp}
      \\usepackage[utf8]{inputenc}
      \\usepackage[T1]{fontenc}
      \\usepackage[hidelinks]{hyperref}


      %-----------------------------------------------------------
      %Edit these values as you see fit

      \\setlength{\\outerbordwidth}{3pt}  % Width of border outside of title bars
      \\definecolor{shadecolor}{gray}{0.75}  % Outer background color of title bars (0 = black, 1 = white)
      ${shadecolorBLine}


      %-----------------------------------------------------------
      %Margin setup

      \\setlength{\\evensidemargin}{-0.25in}
      \\setlength{\\headheight}{0in}
      \\setlength{\\headsep}{0in}
      \\setlength{\\oddsidemargin}{-0.25in}
      \\setlength{\\tabcolsep}{0in}
      \\setlength{\\textheight}{9.5in}
      \\setlength{\\textwidth}{7in}
      \\setlength{\\topmargin}{-0.3in}
      \\setlength{\\topskip}{0in}
      \\setlength{\\voffset}{0.1in}


      %-----------------------------------------------------------
      %Custom commands
      \\newcommand{\\resitem}[1]{\\item #1 \\vspace{-4pt}}
      \\newcommand{\\resheading}[1]{
        \\parbox{\\textwidth}{\\setlength{\\FrameSep}{\\outerbordwidth}
          \\begin{shaded}
      \\setlength{\\fboxsep}{0pt}\\framebox[\\textwidth][l]{\\setlength{\\fboxsep}{4pt}\\fcolorbox{shadecolorB}{shadecolorB}{\\textbf{\\sffamily{\\mbox{~}\\makebox[6.762in][l]{\\large #1} \\vphantom{p\\^{E}}}}}}
          \\end{shaded}
        }\\vspace{-11pt}
      }
      \\newcommand{\\ressubheading}[4]{
      \\begin{tabular*}{6.5in}{l@{\\cftdotfill{\\cftsecdotsep}\\extracolsep{\\fill}}r}
          \\textbf{#1} & #2 \\\\
          \\textit{#3} & \\textit{#4} \\\\

      \\end{tabular*}\\vspace{-6pt}}

      \\newcommand{\\school}[4]{\\vspace{1.5mm}
        \\textbf{#1} \\hfill #2 \\textit{#3} \\hfill \\textit{#4} \\vspace{1.5mm}
      }

      \\newcommand{\\job}[4]{
        \\textbf{#1} \\hfill #2 \\hfill \\textit{#3} \\hfill \\textit{#4}
      }

      \\newcommand{\\skill}[2]{
        \\textbf{#1} #2
      }

      \\newcommand{\\project}[4]{ \\vspace{1.5mm}
        \\textbf{#1} #2 \\hfill \\textit{#3}#4 \\vspace{1.5mm}
      }

      \\newcommand{\\award}[4]{ \\vspace{1.5mm}
        \\textbf{#1} #2 \\hfill \\textit{#3} #4 \\vspace{1.5mm}
      }
      %-----------------------------------------------------------
      ${extraLines}
    `
  }
}

function template3(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // This template lays out margins by hand (\setlength on \textwidth,
  // \oddsidemargin, etc. — see resumeHeader) rather than via `geometry`, and
  // there is no single scalar in that layout to compare a resolved margin
  // against. geometry, loaded only when the caller explicitly asked for a
  // margin, recalculates and wins over the manual \setlength calls above it
  // — though the shaded section-header bar's own hardcoded 6.762in width
  // (resheading, above) does not follow along, a known cosmetic limit of
  // overriding margin on this template.
  const geometryLine =
    values.document.margin !== undefined ? `\\usepackage[margin=${config.margin}]{geometry}` : ''
  const preamble = [generator.resumeHeader(config), geometryLine].filter(Boolean).join('\n')

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

          case 'certificates':
            return (
              generator.certificatesSection?.(
                values.certificates,
                headings.certificates,
                config
              ) ?? defaultCertificatesSection(values.certificates, headings.certificates, config)
            )

          default:
            return ''
        }
      })
      .join('\n')}
    ${WHITESPACE}
    \\end{document}
  `
}

export default template3
