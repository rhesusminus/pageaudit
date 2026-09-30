import { pageKey } from '../../input/resolve.js';
import { SOURCES } from '../../sources.js';
import { truncate } from '../snippet.js';

// Pages whose canonical names another URL. Often intentional (parameters,
// syndicated copies), so this is informational.
export function checkCanonicalTargets(pages) {
  return pages
    .filter(({ facts, finalUrl }) => facts?.canonical && pageKey(facts.canonical) !== pageKey(finalUrl))
    .map(({ url, facts }) => ({
      type: 'canonical-elsewhere',
      severity: 'info',
      category: 'seo',
      source: SOURCES.canonical,
      message: 'Canonical points to a different URL',
      context: truncate(facts.canonical),
      urls: [url],
    }));
}
