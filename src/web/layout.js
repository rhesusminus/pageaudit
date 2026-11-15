// The document every web page shares. The stylesheet and the one script are files under /assets, so the pages run
// under a Content-Security-Policy that allows no inline code. Their addresses carry the version, so a browser that kept
// an older copy fetches the new one after an upgrade.
import pkg from '../../package.json' with { type: 'json' }
import { markup } from '../html/escape.js'

export function document({ title, main, head = '', after = '' }) {
  return markup`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${title}</title>
        <link rel="stylesheet" href="/assets/app.css?v=${pkg.version}" />
        <script type="module" src="/assets/checker.js?v=${pkg.version}"></script>
        ${head}
      </head>
      <body>
        <header class="masthead">
          <a class="wordmark" href="/">pageaudit</a>
        </header>
        <main id="main">${main}</main>
        ${after}
        <footer class="colophon">
          <p>pageaudit ${pkg.version} checks one page at a time. Results stay at their link until someone deletes them.</p>
        </footer>
      </body>
    </html>`.toString()
}
