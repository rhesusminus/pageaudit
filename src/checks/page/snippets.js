import { SOURCES } from '../../sources.js'
import { seoIssue } from '../snippet.js'
import { robotsTags } from './indexing.js'
import { agentRules } from './robots-header.js'

const MAX_SNIPPET = /^max-snippet\s*:\s*(-?\d+)$/

// The length a max-snippet rule allows, null for any other rule. -1 means no limit.
const snippetLength = (rule) => {
  const match = MAX_SNIPPET.exec(rule)
  return match ? Number(match[1]) : null
}

// Every place that gives one crawler rules: the meta tags for these names, then the X-Robots-Tag rules for it.
// Each is { rules, context, found }, where found is the element evidence a header does not have.
function ruleSources($, robotsHeader, names, agent) {
  const tags = robotsTags($, names).map(({ rules, html, found }) => ({ rules, context: html, found }))
  if (!robotsHeader) return tags
  return [...tags, { rules: agentRules(robotsHeader, agent), context: `X-Robots-Tag: ${robotsHeader}`, found: {} }]
}

// The first rule that passes `test`, with the place it came from, or null.
function firstRule(sources, test) {
  for (const source of sources) {
    const rule = source.rules.find(test)
    if (rule) return { rule, source }
  }
  return null
}

// A page that is not indexed shows no snippet anyway, and noindex is already its own issue.
const notIndexed = (sources) => sources.some(({ rules }) => rules.includes('noindex') || rules.includes('none'))

const issue = ({ source }, fields) => seoIssue({ ...fields, context: source.context, ...source.found })

// Google: nosnippet, or max-snippet:0, keeps the text out of snippets and of AI Overviews and AI Mode, while a
// positive max-snippet limits how much of it they use. With several rules the most restrictive one applies.
function googleSnippets(sources) {
  if (notIndexed(sources)) return []
  const none = firstRule(sources, (rule) => rule === 'nosnippet' || snippetLength(rule) === 0)
  if (none) {
    return [
      issue(none, {
        type: 'snippet-restricted',
        severity: 'warning',
        source: SOURCES.robotsMeta,
        message: `The page tells Google not to show a snippet (${none.rule}), so its text is also kept out of AI Overviews and AI Mode`
      })
    ]
  }
  const limits = sources.flatMap((source) =>
    source.rules.map((rule) => ({ rule, source, length: snippetLength(rule) })).filter(({ length }) => length > 0)
  )
  if (!limits.length) return []
  const tightest = limits.reduce((a, b) => (b.length < a.length ? b : a))
  return [
    issue(tightest, {
      type: 'snippet-restricted',
      severity: 'info',
      source: SOURCES.robotsMeta,
      message: `The page limits Google's snippets to ${tightest.length} characters (${tightest.rule}), which also limits how much of it AI Overviews and AI Mode can use`
    })
  ]
}

// Bing: noarchive keeps the page out of Copilot answers, nocache lets them show only its title, address and snippet.
// Bing treats a page with both as nocache.
function bingAnswers(sources) {
  if (notIndexed(sources)) return []
  const nocache = firstRule(sources, (rule) => rule === 'nocache')
  if (nocache) {
    return [
      issue(nocache, {
        type: 'copilot-restricted',
        severity: 'info',
        source: SOURCES.bingCopilot,
        message: 'The page tells Bing to show only its title, address and snippet in Copilot answers (nocache)'
      })
    ]
  }
  const noarchive = firstRule(sources, (rule) => rule === 'noarchive')
  if (!noarchive) return []
  return [
    issue(noarchive, {
      type: 'copilot-restricted',
      severity: 'warning',
      source: SOURCES.bingCopilot,
      message: 'The page tells Bing not to use it in Copilot answers (noarchive)'
    })
  ]
}

// How much of the page Google and Bing may quote in their snippets and AI answers, from its robots meta tags and its
// X-Robots-Tag header (null when not sent).
export const checkSnippetControls = ($, robotsHeader) => [
  ...googleSnippets(ruleSources($, robotsHeader, ['robots', 'googlebot'], 'googlebot')),
  ...bingAnswers(ruleSources($, robotsHeader, ['robots', 'bingbot'], 'bingbot'))
]
