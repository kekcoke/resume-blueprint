import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { accentColorToTeX, GLOBAL_DEFAULTS } from './documentConfig.js'
import { nfssFontPreamble } from './fonts.js'
import type { FormValues, GeneratorWithSummary, ResolvedDocumentConfig } from '../types.js'

const generator: GeneratorWithSummary = {
  profileSection(basics = {}, config) {
    const { name, label, email, phone, location = {}, website, profiles } = basics

    // moderncv has no general-purpose "one line of contact info" slot — each
    // kind (\address, \phone, \email, \homepage) is its own macro, and
    // \makecvtitle stacks them one per line by class design. That's this
    // template's recorded 'stacked' default (documentConfig.ts). An explicit
    // 'row' override folds every field into \extrainfo instead — moderncv's
    // one free-text line — since there's no per-kind macro that prints
    // several fields on a shared line.
    if (config.contactLayout === 'row') {
      const websiteLine = website ? breakableUrl(website) : ''
      const info = [location.address, phone, email, websiteLine, ...profileLinks(profiles)]
        .filter(Boolean)
        .join(' | ')

      return stripIndent`
      % Profile
      \\name{${name || ''}}{}
      ${label ? `\\title{${label}}` : ''}
      ${info ? `\\extrainfo{${info}}` : ''}
    `
    }

    // moderncv has a macro per contact kind and no general-purpose slot, so the
    // profile links go in \extrainfo, which \makecvtitle prints under the rest.
    const extra = profileLinks(profiles).join(' | ')

    // Every contact macro below is guarded on its value. \address was not, and
    // an empty \address{} makes \makecvtitle end a line that has nothing on
    // it — "There's no line here to end", a hard LaTeX error for any blueprint
    // without an address.

    return stripIndent`
    % Profile
    \\name{${name || ''}}{}
    ${label ? `\\title{${label}}` : ''}
    ${location.address ? `\\address{${location.address}}` : ''}
    ${phone ? `\\phone[mobile]{${phone}}` : ''}
    ${email ? `\\email{${email || ''}}` : ''}
    ${website ? `\\homepage{${website || ''}}` : ''}
    ${extra ? `\\extrainfo{${extra}}` : ''}
  `
  },

  // \title is moderncv's own slot for a job title and \makecvtitle prints it
  // under the name, so `label` needs nothing here. The summary is a paragraph
  // and has to follow \makecvtitle in the body.
  summarySection(basics) {
    const { summary } = basics || {}

    if (!summary) {
      return ''
    }

    return stripIndent`
      ${summary}
      \\medskip
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Education'}}
      ${education.map((school) => {
        const {
          institution,
          studyType = '',
          area = '',
          score,
          location,
          startDate,
          endDate = ''
        } = school

        let degreeLine = ''

        if (studyType && area) {
          degreeLine = `${studyType} in ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
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
          \\cventry
            {${dateRange || ''}}
            {${degreeLine}}
            {${institution || ''}}
            {${score ? `GPA: ${score}` : ''}}
            {\\textit{${location || ''}}}
            {}
        `
      })}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Experience'}}
      ${work.map((job) => {
        const {
          name,
          position,
          location,
          startDate,
          endDate = '',
          summary,
          highlights
        } = job

        let dateRange = ''
        let highlightLines = ''

        // \endgraf rather than \par: moderncv's \cventry is a \newcommand*, and a
        // \par token during its argument scan aborts the compile.
        if (startDate && endDate) {
          dateRange = `${startDate} -- ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} -- Present`
        } else {
          dateRange = endDate
        }

        if (highlights?.length) {
          highlightLines = source`
            \\begin{itemize}%
              \\setlength\\itemsep{${config.bulletSpacing}pt}
              ${highlights.map((highlight) => `\\item ${highlight}`)}
            \\end{itemize}
            `
        }

        return stripIndent`
          \\cventry
            {${dateRange || ''}}
            {${position || ''}}
            {${name || ''}}
            {${location || ''}}
            {}
            {${summary ? `${summary}\\endgraf` : ''}${highlightLines}}
        `
      })}
    `
  },

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Skills'}}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        return `\\cvitem{${name || ''}}{${keywords.join(', ')}}`
      })}
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Projects'}}
      ${projects.map((project) => {
        const { name, description, keywords = [], url } = project

        let detailsLine = ''

        if (description) {
          detailsLine += `${description}\\\\`
        }

        if (url) {
          detailsLine += url
        }

        return stripIndent`
          \\cventry
            {}
            {${name || ''}}
            {}
            {\\textit{${keywords.join(', ')}}}
            {}
            {${detailsLine}}
          \\vspace{1mm}
        `
      })}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Awards'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        let detailsLine = ''

        if (summary) {
          detailsLine += `${summary}\\\\`
        }

        if (awarder) {
          detailsLine += awarder
        }

        return stripIndent`
          \\cventry
            {}
            {${title || ''}}
            {}
            {\\textit{${date || ''}}}
            {}
            {${detailsLine}}
          \\vspace{1mm}
        `
      })}
    `
  },

  certificatesSection(certificates, heading, config) {
    if (!certificates) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Certificates'}}
      \\begin{itemize}
      \\setlength\\itemsep{${config.bulletSpacing}pt}
      ${certificates.map((cert) => `\\item ${certificateLine(cert)}`)}
      \\end{itemize}
    `
  },

  resumeHeader(config) {
    // TEMPLATE_DEFAULTS[7] is {paper: 'letter', fontSize: 10}, matching this
    // class line's current literal '[letterpaper]' (moderncv follows the
    // standard LaTeX size-option convention, whose default absent an option
    // is 10pt — see documentConfig.ts).
    const paperOption = config.paper === 'a4' ? 'a4paper' : 'letterpaper'
    const sizeOption = config.fontSize === 10 ? '' : `,${config.fontSize}pt`
    const classLine = `\\documentclass[${paperOption}${sizeOption}]{moderncv}        % possible options include font size ('10pt', '11pt' and '12pt'), paper size ('a4paper', 'letterpaper', 'a5paper', 'legalpaper', 'executivepaper' and 'landscape') and font family ('sans' and 'roman')`

    // scale=0.75 is moderncv's own proportional margin, not a length. There
    // is no raw `document` input available inside this method (Generator's
    // resumeHeader takes only the resolved config — see types.ts), and
    // loading `geometry` a second time with different options is a hard
    // LaTeX "Option clash" error, so this can't be additive the way other
    // templates' margin overrides are. Comparing against GLOBAL_DEFAULTS.margin
    // is the next best gate: it only misses the one case where a caller
    // explicitly asks for exactly 0.75in, which scale=0.75 already
    // approximates closely enough to not be worth the type-signature change.
    const geometryLine =
      config.margin === GLOBAL_DEFAULTS.margin
        ? '\\usepackage[scale=0.75]{geometry}'
        : `\\usepackage[margin=${config.margin}]{geometry}`

    // Defining "blue" before \moderncvcolor{blue} selects it is what makes
    // the override take: moderncv builds its internal palette by reading
    // the named color \moderncvcolor is given, not by patching after.
    // Joined with \moderncvstyle via filter(Boolean) below rather than
    // interpolated on its own line, so an unset accentColor contributes no
    // line at all, not a blank one.
    const styleBlock = [
      '\\moderncvstyle{banking}                             % style options are \'casual\' (default), \'classic\', \'oldstyle\' and \'banking\'',
      config.accentColor ? `\\definecolor{blue}{HTML}{${accentColorToTeX(config.accentColor)}}` : ''
    ]
      .filter(Boolean)
      .join('\n')

    const extraLines = [
      config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
      config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
      nfssFontPreamble(7, config)
    ]
      .filter(Boolean)
      .join('\n')

    return stripIndent`
      %% start of file 'template.tex'.
      %% Copyright 2006-2013 Xavier Danaux (xdanaux@gmail.com).
      %
      % This work may be distributed and/or modified under the
      % conditions of the LaTeX Project Public License version 1.3c,
      % available at http://www.latex-project.org/lppl/.


      ${classLine}
      \\usepackage{textcomp}
      % moderncv themes
      ${styleBlock}
      \\moderncvcolor{blue}                               % color options 'blue' (default), 'orange', 'green', 'red', 'purple', 'grey' and 'black'
      %\\renewcommand{\\familydefault}{\\sfdefault}         % to set the default font; use '\\sfdefault' for the default sans serif font, '\\rmdefault' for the default roman one, or any tex font name
      %\\nopagenumbers{}                                  % uncomment to suppress automatic page numbering for CVs longer than one page

      % character encoding
      \\usepackage[utf8]{inputenc}                       % if you are not using xelatex ou lualatex, replace by the encoding you are using
      %\\usepackage{CJKutf8}                              % if you need to use CJK to typeset your resume in Chinese, Japanese or Korean

      % adjust the page margins
      ${geometryLine}
      %\\setlength{\\hintscolumnwidth}{3cm}                % if you want to change the width of the column with the dates
      %\\setlength{\\makecvtitlenamewidth}{10cm}           % for the 'classic' style, if you want to force the width allocated to your name and avoid line breaks. be careful though, the length is normally calculated to avoid any overlap with your personal info; use this at your own typographical risks...
      ${extraLines}
    `
  }
}

function template7(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  return stripIndent`
    ${generator.resumeHeader(config)}
    ${generator.profileSection(values.basics, config)}
    \\begin{document}
    ${values.basics ? '\\makecvtitle' : ''}
    ${generator.summarySection(values.basics, config)}
    ${values.sections
      .map((section) => {
        switch (section) {
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

export default template7
