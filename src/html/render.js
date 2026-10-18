import pkg from '../../package.json' with { type: 'json' }
import { markup, raw } from './escape.js'
import { averageScores, groupIssues, pageHealth, pagesWithSiteIssues } from '../overview.js'
import { siteWideIssues, verdict } from './model.js'
import { cover, fixesSection, healthSection, methodSection, pagesSection } from './sections.js'
import { CSS } from './styles.js'

// Opens every collapsed section while printing, so a PDF holds the whole report.
const PRINT_SCRIPT = `(function(){var closed=[];addEventListener('beforeprint',function(){closed=[].slice.call(document.querySelectorAll('details:not([open])'));closed.forEach(function(d){d.open=true})});addEventListener('afterprint',function(){closed.forEach(function(d){d.open=false})})})()`

export const DEFAULT_TITLE = 'Website audit'

// Renders the report as one self-contained HTML document: inline CSS, no external
// requests, readable offline and printable to PDF. `logo` is a data URI.
export function renderHtml(report, { title = DEFAULT_TITLE, client = null, logo = null, timeZone } = {}) {
  const pages = pagesWithSiteIssues(report)
  const health = pageHealth(pages)
  const scores = averageScores(report.pages)
  const groups = groupIssues(report)
  const totalUrls = report.coverage?.urls.found ?? report.pages.length
  const heading = client ? `${title} - ${client}` : title
  return markup`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${heading}</title>
        <style>
          ${raw(CSS)}
        </style>
      </head>
      <body>
        ${cover({ report, title, client, logo, timeZone, scores, verdict: verdict(report.summary, health, siteWideIssues(report)) })}
        <main class="wrap">
          ${healthSection(health, report.summary, { skipped: report.skipped, totalUrls })} ${fixesSection(groups)} ${pagesSection(pages, report.lighthouseAudits)}
          ${methodSection(report)}
        </main>
        <footer class="wrap site-footer"><p>Created with pageaudit ${pkg.version}.</p></footer>
        <script>
          ${raw(PRINT_SCRIPT)}
        </script>
      </body>
    </html> `.toString()
}
