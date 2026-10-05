import pkg from '../../package.json' with { type: 'json' }
import { markup, raw } from './escape.js'
import { averageScores, groupIssues, pageHealth, verdict } from './model.js'
import { cover, fixesSection, healthSection, methodSection, pagesSection } from './sections.js'
import { CSS } from './styles.js'

// Opens every collapsed section while printing, so a PDF holds the whole report.
const PRINT_SCRIPT = `(function(){var closed=[];addEventListener('beforeprint',function(){closed=[].slice.call(document.querySelectorAll('details:not([open])'));closed.forEach(function(d){d.open=true})});addEventListener('afterprint',function(){closed.forEach(function(d){d.open=false})})})()`

// Renders the report as one self-contained HTML document: inline CSS, no external
// requests, readable offline and printable to PDF. `logo` is a data URI.
export function renderHtml(report, { title = 'Website audit', client = null, logo = null } = {}) {
  const health = pageHealth(report.pages)
  const scores = averageScores(report.pages)
  const groups = groupIssues(report)
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
        ${cover({ report, title, client, logo, scores, verdict: verdict(report.summary, health) })}
        <main class="wrap">
          ${healthSection(health, report.summary)} ${fixesSection(groups)} ${pagesSection(report.pages)}
          ${methodSection(report)}
        </main>
        <footer class="wrap site-footer"><p>Created with pageaudit ${pkg.version}.</p></footer>
        <script>
          ${raw(PRINT_SCRIPT)}
        </script>
      </body>
    </html> `.toString()
}
