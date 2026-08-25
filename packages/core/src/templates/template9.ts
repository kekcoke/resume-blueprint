import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { accentColorToTeX } from './documentConfig.js'
import { nfssFontPreamble, isFontSupported } from './fonts.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics, config) {
    if (!basics) {
      return ''
    }

    const {
      name,
      label,
      summary,
      email,
      phone,
      location = {},
      website,
      profiles
    } = basics
    const websiteLine = website
      ? `\\href{${website}}{${breakableUrl(website)}}`
      : ''

    const info = joinContactInfo(
      [email, phone, location.address, websiteLine, ...profileLinks(profiles)],
      config.contactLayout,
      ' | '
    )

    // \MySlogan is defined in this template's own preamble for exactly this and
    // has gone unused since the extraction.
    const labelLine = label ? `\\MySlogan{${label}}` : ''
    const summaryBlock = summary
      ? `\n\\smallskip\n{\\small ${summary}\\par}`
      : ''

    return stripIndent`
      \\MyName{${name || ''}}
      ${labelLine}
      \\bigskip
      {\\small \\hfill ${info || ''}}
      ${summaryBlock}
    `
  },

  educationSection(education, heading) {
    if (!education) {
      return ''
    }

    const lastSchoolIndex = education.length - 1

    return source`
      %%% Education
      %%% ------------------------------------------------------------
      \\NewPart{${heading || 'Education'}}{}
      ${education.map((school, i) => {
        const {
          institution = '',
          studyType,
          area = '',
          score = '',
          location = '',
          startDate = '',
          endDate = ''
        } = school

        let degreeLine = ''
        let nameLine = ''

        if (studyType && area) {
          degreeLine = `${studyType} ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
        }

        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} - ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} - Present`
        } else {
          dateRange = endDate
        }

        if (institution && location) {
          nameLine += `${institution}, ${location}`
        } else if (institution || location) {
          nameLine = institution || location
        }

        if (score) {
          nameLine += ` ${score}`
        }

        return stripIndent`
          \\EducationEntry
            {${degreeLine}}
            {${dateRange || ''}}
            {${nameLine}}
            ${i < lastSchoolIndex ? '\\sepspace' : ''}
        `
      })}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    const lastJobIndex = work.length - 1

    return source`
      %%% Work experience
      %%% ------------------------------------------------------------

      \\NewPart{${heading || 'Experience'}}{}

      ${work.map((job, i) => {
        const {
          name,
          position,
          location,
          startDate,
          endDate = '',
          summary,
          highlights
        } = job

        const nameLine = [name, location].filter(Boolean).join(', ')
        let dateRange = ''
        let dutyLines = ''

        if (startDate && endDate) {
          dateRange = `${startDate} - ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} - Present`
        } else {
          dateRange = endDate
        }

        if (highlights?.length) {
          dutyLines = source`
            \\begin{itemize} \\itemsep ${config.bulletSpacing}pt
              ${highlights.map((duty) => `\\item ${duty}`)}
            \\end{itemize}
          `
        }

        return stripIndent`
          \\WorkEntry
            {${position || ''}}
            {${dateRange || ''}}
            {${nameLine}}
            {${summary ? `${summary}\\par` : ''}${dutyLines}}
            ${i < lastJobIndex ? '\\sepspace' : ''}
        `
      })}
    `
  },

  skillsSection(skills, heading) {
    if (!skills) {
      return ''
    }

    return source`
      %%% Skills
      %%% ------------------------------------------------------------
      \\NewPart{${heading || 'Skills'}}{}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        return `\\SkillsEntry{${name ? `${name}:` : ''}}{${keywords.join(', ')}}`
      })}
    `
  },

  projectsSection(projects, heading) {
    if (!projects) {
      return ''
    }

    const lastProjectIndex = projects.length - 1

    return source`
      %%% Projects
      %%% ------------------------------------------------------------
      \\NewPart{${heading || 'Projects'}}{}

      ${projects.map((project, i) => {
        const { name, description, keywords = [], url } = project
        const urlLine = url ? `\\href{${url}}{${url}}` : ''

        return stripIndent`
          \\ProjectEntry{${name || ''}}{${urlLine || ''}}
          {${keywords.join(', ')}}
          {${description || ''}}
          ${i < lastProjectIndex ? '\\sepspace' : ''}
        `
      })}
    `
  },

  awardsSection(awards, heading) {
    if (!awards) {
      return ''
    }

    const lastAwardIndex = awards.length - 1

    return source`
      %%% Awards
      %%% ------------------------------------------------------------
      \\NewPart{${heading || 'Awards'}}{}

      ${awards.map((award, i) => {
        const { title, summary, date, awarder } = award

        return stripIndent`
          \\AwardEntry{${title || ''}}{${awarder || ''}}
          {${date || ''}}
          {${summary || ''}}
          ${i < lastAwardIndex ? '\\sepspace' : ''}
        `
      })}
    `
  },

  certificatesSection(certificates, heading, config) {
    if (!certificates) {
      return ''
    }

    return source`
      %%% Certificates
      %%% ------------------------------------------------------------
      \\NewPart{${heading || 'Certificates'}}{}
      \\begin{itemize} \\itemsep ${config.bulletSpacing}pt
        ${certificates.map((cert) => `\\item ${certificateLine(cert)}`)}
      \\end{itemize}
    `
  },

  resumeHeader(config) {
    // TEMPLATE_DEFAULTS[9] is {paper: 'letter', margin: '0.75in'}, matching
    // this line's current literal exactly — a direct replacement rather
    // than an additive one, since both fields resolve to what's already
    // hardcoded unless the caller overrides.
    const paperOption = config.paper === 'a4' ? 'a4paper,' : ''
    const geometryLine = `\\usepackage[${paperOption}margin=${config.margin}]{geometry}`

    const extraLines = [
      config.lineSpacing !== 1.0
        ? `\\linespread{${config.lineSpacing}}\\selectfont`
        : '',
      config.linkStyle === 'colored'
        ? '\\hypersetup{colorlinks=true,allcolors=blue}'
        : '',
      nfssFontPreamble(9, config)
    ]
      .filter(Boolean)
      .join('\n')

    // Applied only to the section-heading rule, not the EducationEntry/
    // WorkEntry duration boxes below (\colorbox{Black}) — those are
    // multi-use macro bodies where a conditional swap would mean carrying
    // two full copies of each macro just to vary one color reference, out
    // of proportion with what F3 threading needs to prove. Prefixed inline
    // on the \usefont line rather than given its own line, so an unset
    // accentColor reproduces that line byte-for-byte.
    const sectionColor = config.accentColor
      ? `\\color[HTML]{${accentColorToTeX(config.accentColor)}}`
      : ''

    // \MyName/\MySlogan/\sectionfont hardcode `\usefont{OT1}{phv}{...}` —
    // Helvetica by deliberate choice, not a stand-in for whatever
    // \sfdefault happens to resolve to (lmodern's default sans, absent any
    // override), so this can't be a blanket `phv` -> `\sfdefault` swap
    // without changing default (fontFamily: 'template') output. Only swap
    // when a supported override is actually active, and swap the encoding
    // too: `\usefont{OT1}{\sfdefault}{...}` was tried and rejected — it
    // silently falls back to Computer Modern (`cmr10`) for carlito/arimo,
    // since their fontspec/OpenType-feature routes have no OT1-encoded
    // shape. `\encodingdefault` tracks whatever encoding is actually active
    // and resolves correctly for all four NFSS families in the spike.
    const fontOverrideActive =
      config.fontFamily !== 'template' && isFontSupported(9, config.fontFamily)
    const sectionFontEncoding = fontOverrideActive ? '\\encodingdefault' : 'OT1'
    const sectionFontFamily = fontOverrideActive ? '\\sfdefault' : 'phv'

    return stripIndent`
      \\usepackage[english]{babel}
      \\usepackage[utf8]{inputenc}
      \\usepackage[T1]{fontenc}
      \\usepackage{lmodern}
      % expansion=false: microtype's font expansion is a pdfTeX feature and errors
      % out under XeTeX-derived engines such as Tectonic. Protrusion, which does
      % the bulk of the visible optical-margin work, is supported and stays on.
      \\usepackage[protrusion=true,expansion=false]{microtype}
      \\usepackage[svgnames]{xcolor}  % Colours by their 'svgnames'
      ${geometryLine}
        % 700bp, not 700px: "px" is a pdfTeX-only unit and XeTeX-derived engines
        % (including Tectonic) reject it. pdfTeX's \\pdfpxdimen defaults to 1bp,
        % so this is the identical length, portably spelled.
        \\textheight=700bp
      \\usepackage{url}
      \\usepackage{lmodern} % Allow arbitrary font sizes
      \\usepackage{textcomp}
      \\usepackage[hidelinks]{hyperref}

      %% Define a new 'modern' style for the url package that will use a smaller font.
      \\makeatletter
      \\def\\url@modernstyle{
        \\@ifundefined{selectfont}{\\def\\UrlFont{\\sf}}{\\def\\UrlFont{}}}
      \\makeatother
      \\urlstyle{modern} %% And use the newly defined style.

      \\frenchspacing              % Better looking spacings after periods
      \\pagestyle{empty}           % No pagenumbers/headers/footers

      \\renewcommand{\\familydefault}{\\sfdefault}

      %%% Custom sectioning (sectsty package)
      %%% ------------------------------------------------------------
      \\usepackage{sectsty}

      \\sectionfont{                 % Change font of \\section command
        ${sectionColor}\\usefont{${sectionFontEncoding}}{${sectionFontFamily}}{b}{n}%   % bch-b-n: CharterBT-Bold font
        \\sectionrule{0pt}{0pt}{-5pt}{3pt}}

      %%% Macros
      %%% ------------------------------------------------------------
      \\newlength{\\spacebox}
      \\settowidth{\\spacebox}{8888888888}      % Box to align text
      \\newcommand{\\sepspace}{\\vspace*{1em}}   % Vertical space macro

      \\newcommand{\\MyName}[1]{ % Name
          \\Huge \\usefont{${sectionFontEncoding}}{${sectionFontFamily}}{b}{n} \\hfill #1
          \\par \\normalsize \\normalfont}

      \\newcommand{\\MySlogan}[1]{ % Slogan (optional)
          \\large \\usefont{${sectionFontEncoding}}{${sectionFontFamily}}{m}{n}\\hfill \\textit{#1}
          \\par \\normalsize \\normalfont}

      \\newcommand{\\NewPart}[1]{\\vspace{${config.sectionSpacing}pt}\\section*{\\uppercase{#1}}}

      \\newcommand{\\PersonalEntry}[2]{
          \\noindent\\hangindent=2em\\hangafter=0 % Indentation
          \\parbox{\\spacebox}{                  % Box to align text
          \\textit{#1}}                      % Entry name (birth, address, etc.)
          \\hspace{1.5em} #2 \\par}              % Entry value

      % Not \parbox{\spacebox}{...}-based like its \PersonalEntry/\AwardsEntry
      % siblings: a fixed-width box puts the category label and its keywords
      % in what a parser reads as two separate fragments, the same defect as
      % a two-column tabular (F5). Single-line concatenation instead.
      \\newcommand{\\SkillsEntry}[2]{
          \\noindent\\hangindent=2em\\hangafter=0 % Indentation
          \\textbf{#1} #2 \\par}                 % Entry name, then its value

      \\newcommand{\\AwardsEntry}[2]{                % Same as \\PersonalEntry
          \\noindent\\hangindent=2em\\hangafter=0 % Indentation
          \\parbox{\\spacebox}{                  % Box to align text
          \\textit{#1}}                    % Entry name (birth, address, etc.)
          \\hspace{1.5em} #2 \\par}              % Entry value

      \\newcommand{\\EducationEntry}[4]{
          \\noindent \\textbf{#1} \\hfill      % Study
          \\colorbox{Black}{
            \\parbox{8.5em}{
            \\hfill\\color{White}#2}} \\par  % Duration
          \\noindent \\textit{#3} \\par        % School
          \\noindent\\hangindent=2em\\hangafter=0 \\small #4 % Description
          \\normalsize \\par}

      \\newcommand{\\WorkEntry}[4]{       % Same as \\EducationEntry
          \\noindent \\textbf{#1} \\hfill      % Jobname
          \\colorbox{Black}{%
            \\parbox{9em}{%
            \\hfill\\color{White}#2}} \\par   % Duration
              \\noindent \\textit{#3} \\par        % Company
          \\noindent\\hangindent=2em\\hangafter=0 \\small #4 % Description
          \\normalsize \\par}

      \\newcommand{\\ProjectEntry}[4]{         % Similar to \\EducationEntry
          \\noindent \\textbf{#1} \\noindent \\textit{#3} \\hfill {#2} \\par
          \\noindent \\small #4 % Description
          \\normalsize \\par}

      \\newcommand{\\AwardEntry}[4]{         % Similar to \\EducationEntry
          \\noindent \\textbf{#1} \\noindent \\textit{#3} \\hfill {#2} \\par
          \\noindent \\small #4 % Description
          \\normalsize \\par}
      ${extraLines}
    `
  }
}

function template9(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // TEMPLATE_DEFAULTS[9].fontSize is 10, not 11: this line's current
  // 'fontsize=11pt' is a KOMA-Script option plain `article` silently
  // ignores (dead code — see documentConfig.ts), rendering at 10pt today
  // regardless of what it says. Reproducing that exact literal when
  // fontSize is unset keeps `document` omitted byte-identical; an explicit
  // override emits correct '<n>pt' syntax instead and actually takes
  // effect, fixing the bug only when someone opts in.
  const paperOption = config.paper === 'a4' ? 'a4paper,' : ''
  const sizeOption =
    config.fontSize === 10 ? 'fontsize=11pt' : `${config.fontSize}pt`
  const classLine = `\\documentclass[${paperOption}${sizeOption}]{article}`

  return stripIndent`
    ${classLine}
    ${generator.resumeHeader(config)}
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
            return generator.skillsSection(
              values.skills,
              headings.skills,
              config
            )

          case 'projects':
            return generator.projectsSection(
              values.projects,
              headings.projects,
              config
            )

          case 'awards':
            return generator.awardsSection(
              values.awards,
              headings.awards,
              config
            )

          case 'certificates':
            return (
              generator.certificatesSection?.(
                values.certificates,
                headings.certificates,
                config
              ) ??
              defaultCertificatesSection(
                values.certificates,
                headings.certificates,
                config
              )
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

export default template9
