import template1 from './template1.js'
import template2 from './template2.js'
import template3 from './template3.js'
import template4 from './template4.js'
import template5 from './template5.js'
import template6 from './template6.js'
import template7 from './template7.js'
import template8 from './template8.js'
import template9 from './template9.js'
import template10 from './template10.js'
import {
  TEMPLATE1,
  TEMPLATE2,
  TEMPLATE3,
  TEMPLATE4,
  TEMPLATE5,
  TEMPLATE6,
  TEMPLATE7,
  TEMPLATE8,
  TEMPLATE9,
  TEMPLATE10
} from './constants.js'
import { resolveDocumentConfig } from './documentConfig.js'
import { fontFiles } from './fonts.js'
import { FormValues, TemplateData } from '../types.js'

/**
 * Generates the LaTeX document based on the selected template
 * as well as the necessary options needed for it to create a pdf.
 *
 * @param data - The sanitized form data from the request body.
 *
 * @return The generated LaTeX document as well as its additional opts.
 */
export default function getTemplateData(data: FormValues): TemplateData {
  // Resolved once per render, against this template's own defaults, and
  // threaded into every templateN call below — including the `default:`
  // fallback, so an unregistered `selectedTemplate` still gets a config
  // resolved against template 1's defaults rather than an empty object.
  const config = resolveDocumentConfig(data.selectedTemplate, data.document)

  switch (data.selectedTemplate) {
    case TEMPLATE1:
      return {
        texDoc: template1(data, config),
        opts: {
          cmd: 'pdflatex',
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE2:
      return {
        texDoc: template2(data, config),
        opts: {
          cmd: 'xelatex',
          inputs: [
            'template2/awesome-cv.cls',
            'template2/fontawesome.sty'
          ],
          fonts: [
            'template2/fonts/FontAwesome.otf',
            'template2/fonts/Roboto-Bold.ttf',
            'template2/fonts/Roboto-BoldItalic.ttf',
            'template2/fonts/Roboto-Italic.ttf',
            'template2/fonts/Roboto-Light.ttf',
            'template2/fonts/Roboto-LightItalic.ttf',
            'template2/fonts/Roboto-Medium.ttf',
            'template2/fonts/Roboto-MediumItalic.ttf',
            'template2/fonts/Roboto-Regular.ttf',
            'template2/fonts/Roboto-Thin.ttf',
            'template2/fonts/Roboto-ThinItalic.ttf',
            'template2/fonts/SourceSansPro-Bold.otf',
            'template2/fonts/SourceSansPro-BoldIt.otf',
            'template2/fonts/SourceSansPro-It.otf',
            'template2/fonts/SourceSansPro-Light.otf',
            'template2/fonts/SourceSansPro-LightIt.otf',
            'template2/fonts/SourceSansPro-Regular.otf',
            'template2/fonts/SourceSansPro-Semibold.otf',
            'template2/fonts/SourceSansPro-SemiboldIt.otf',
            ...fontFiles(config)
          ]
        }
      }

    case TEMPLATE3:
      return {
        texDoc: template3(data, config),
        opts: {
          cmd: 'pdflatex',
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE4:
      return {
        texDoc: template4(data, config),
        opts: {
          cmd: 'xelatex',
          inputs: ['template4/deedy-resume-openfont.cls'],
          fonts: [
            'template4/fonts/Raleway-Bold.otf',
            'template4/fonts/Raleway-ExtraBold.otf',
            'template4/fonts/Raleway-ExtraLight.otf',
            'template4/fonts/Raleway-Heavy.otf',
            'template4/fonts/Raleway-Light.otf',
            'template4/fonts/Raleway-Medium.otf',
            'template4/fonts/Raleway-Regular.otf',
            'template4/fonts/Raleway-SemiBold.otf',
            'template4/fonts/Raleway-Thin.otf',
            ...fontFiles(config)
          ]
        }
      }

    case TEMPLATE5:
      return {
        texDoc: template5(data, config),
        opts: {
          cmd: 'xelatex',
          inputs: [
            'template5/helvetica.sty',
            'template5/res.cls'
          ],
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE6:
      return {
        texDoc: template6(data, config),
        opts: {
          cmd: 'xelatex',
          inputs: [
            'template6/custom-command.tex',
            'template6/minimal-resume-config.tex',
            'template6/minimal-resume.sty'
          ],
          fonts: [
            'template6/fonts/CrimsonText-Bold.ttf',
            'template6/fonts/CrimsonText-BoldItalic.ttf',
            'template6/fonts/CrimsonText-Italic.ttf',
            'template6/fonts/CrimsonText-Regular.ttf',
            'template6/fonts/CrimsonText-Roman.ttf',
            'template6/fonts/CrimsonText-SemiBold.ttf',
            'template6/fonts/CrimsonText-SemiBoldItalic.ttf',
            'template6/fonts/Montserrat-Bold.ttf',
            'template6/fonts/Montserrat-Light.otf',
            'template6/fonts/Montserrat-Regular.ttf',
            ...fontFiles(config)
          ]
        }
      }

    case TEMPLATE7:
      return {
        texDoc: template7(data, config),
        opts: {
          cmd: 'pdflatex',
          // The vendored moderncv files are v1.3.0 from 2013 and are deliberately
          // NOT staged. Staging only part of the package meant LaTeX resolved the
          // rest from Tectonic's bundle, mixing two versions and failing with
          // "Command \makecvtitlenamewidth already defined". Letting the bundle
          // supply moderncv in full keeps it self-consistent. The unstaged copies
          // are kept under assets/ for reference and license attribution.
          inputs: ['template7/collection.sty', 'template7/tweaklist.sty'],
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE8:
      return {
        texDoc: template8(data, config),
        opts: {
          cmd: 'xelatex',
          inputs: ['template8/mcdowellcv.cls'],
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE9:
      return {
        texDoc: template9(data, config),
        opts: {
          cmd: 'pdflatex',
          fonts: [...fontFiles(config)]
        }
      }

    case TEMPLATE10:
      return {
        texDoc: template10(data, config),
        opts: {
          cmd: 'pdflatex',
          fonts: [...fontFiles(config)]
        }
      }

    default:
      return {
        texDoc: template1(data, config),
        opts: {
          cmd: 'pdflatex',
          fonts: [...fontFiles(config)]
        }
      }
  }
}
