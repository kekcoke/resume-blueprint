import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks } from './profiles.js'
import type { FormValues, GeneratorWithSummary } from '../types.js'

const generator: Omit<GeneratorWithSummary, 'resumeHeader'> = {
  profileSection(basics) {
    if (!basics) {
      return ''
    }

    const { name } = basics

    // Only the name goes in the header. res.cls typesets each \address in an
    // \hbox that does not wrap and accepts at most two of them, which is not
    // enough for an email, a phone, a location, a site, and a couple of profile
    // links — the tail crossed the right margin and vanished. Everything else
    // moves to summarySection, which renders in the body where text wraps.
    return stripIndent`
      \\name{{\\LARGE ${name || ''}}}
    `
  },

  // Name / title / contacts / summary, in that order: it is the order a reader
  // and a parser both expect, and it keeps the contact details adjacent to the
  // name rather than stranded at the bottom of the header.
  summarySection(basics) {
    if (!basics) {
      return ''
    }

    const { label, summary, email, phone, location = {}, website, profiles } = basics
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    const contacts = [email, phone, location.address, websiteLine, ...profileLinks(profiles)]
      .filter(Boolean)
      .join(' | ')

    if (!label && !summary && !contacts) {
      return ''
    }

    return stripIndent`
      ${label ? `{\\large \\sl ${label}}\\\\[2pt]` : ''}
      ${contacts ? `${contacts}\\\\[2pt]` : ''}
      ${summary || ''}
      \\vspace{2mm}
    `
  },

  educationSection(education, heading) {
    if (!education) {
      return ''
    }

    const lastSchoolIndex = education.length - 1

    return source`
      \\section{${heading || 'EDUCATION'}}
      ${education.map((school, i) => {
        const {
          institution,
          location,
          studyType = '',
          area = '',
          score,
          startDate,
          endDate = ''
        } = school

        let schoolLine = ''
        let degreeLine = ''

        if (institution) {
          schoolLine += `\\textbf{${institution}}, `
        }

        if (studyType && area) {
          degreeLine = `${studyType} in ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
        }

        if (degreeLine) {
          schoolLine += `{\\sl ${degreeLine}} `
        }

        if (score) {
          schoolLine += `GPA: ${score}`
        }

        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (dateRange) {
          schoolLine += `\\hfill ${dateRange}`
        }

        if (schoolLine) {
          schoolLine += '\\\\'
        }

        if (location) {
          schoolLine += `${location}`
        }

        if (i !== lastSchoolIndex) {
          schoolLine += '\\\\\\\\'
        }

        return schoolLine
      })}
    `
  },

  workSection(work, heading) {
    if (!work) {
      return ''
    }

    return source`
      \\section{${heading || 'EXPERIENCE'}}
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

        let jobLine = ''
        let dateRange = ''

        if (name) {
          jobLine += `\\textbf{${name}}, `
        }

        if (position) {
          jobLine += `{\\sl ${position}}`
        }

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (dateRange) {
          jobLine += `\\hfill ${dateRange}`
        }

        if (jobLine) {
          jobLine += '\\\\'
        }

        if (location) {
          jobLine += `${location}\\\\`
        }

        if (summary) {
          jobLine += `${summary}\\\\`
        }

        if (highlights) {
          jobLine += source`
            \\begin{itemize} \\itemsep 3pt
            ${highlights.map((highlight) => `\\item ${highlight}`)}
            \\end{itemize}
          `
        }

        return jobLine
      })}
    `
  },

  skillsSection(skills, heading) {
    if (!skills) {
      return ''
    }

    // p-columns rather than 'l': see template1's skillsSection.
    return source`
      \\section{${heading || 'SKILLS'}}
      \\begin{tabular}{@{}p{7em}@{\\hspace{1em}}p{\\dimexpr\\linewidth-8em\\relax}@{}}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        return `\\textbf{${name || ''}}: & ${keywords.join(', ') || ''}\\\\`
      })}
      \\end{tabular}
    `
  },

  projectsSection(projects, heading) {
    if (!projects) {
      return ''
    }

    return source`
      \\section{${heading || 'PROJECTS'}}
      ${projects.map((project) => {
        const { name, description, keywords = [], url } = project

        let projectLine = ''

        if (name) {
          projectLine += `\\textbf{${name}}`
        }

        if (keywords) {
          projectLine += `, {\\sl ${keywords.join(', ')}}`
        }

        if (description) {
          projectLine += projectLine ? `\\\\ ${description}` : description
        }

        if (url) {
          const urlLine = url ? `\\href{${url}}{${url}}` : ''
          projectLine += projectLine ? `\\\\ ${urlLine}` : urlLine
        }

        if (projectLine) {
          projectLine += '\\\\\\\\'
        }

        return projectLine
      })}
    `
  },

  awardsSection(awards, heading) {
    if (!awards) {
      return ''
    }

    return source`
      \\section{${heading || 'AWARDS'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        return stripIndent`
            \\textbf{${title || ''}}, {\\sl ${awarder || ''}} \\hfill ${
          date || ''
        } \\\\
            ${summary || ''} \\\\\\\\
        `
      })}
    `
  }
}

function template5(values: FormValues) {
  const { headings = {} } = values

  return stripIndent`
    \\documentclass[line,margin]{res}
    \\usepackage[none]{hyphenat}
    \\usepackage{textcomp}
    \\usepackage[utf8]{inputenc}
    \\usepackage[T1]{fontenc}
    \\usepackage[hidelinks]{hyperref}
    \\begin{document}
      ${generator.profileSection(values.basics)}
      \\begin{resume}
        \\vspace{-5mm}
        ${generator.summarySection(values.basics)}
        ${values.sections
          .map((section) => {
            switch (section) {
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
                return generator.projectsSection(
                  values.projects,
                  headings.projects
                )

              case 'awards':
                return generator.awardsSection(values.awards, headings.awards)

              default:
                return ''
            }
          })
          .join('\n')}
        ${WHITESPACE}
      \\end{resume}
    \\end{document}
  `
}

export default template5
