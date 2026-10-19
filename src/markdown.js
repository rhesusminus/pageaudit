import { imageSrc, mainArea } from './checks/page/content.js'
import { absolute, baseUrl } from './checks/page/signals.js'
import { isElement } from './parse.js'

// Elements whose content runs on in the line around them, old presentational ones such as <font> included. Every
// other element starts a block of its own.
const INLINE = new Set(
  [
    'a abbr acronym b bdi bdo big br cite code data del dfn em font i img ins kbd label mark nobr q s samp small span',
    'strike strong sub sup time tt u var wbr'
  ]
    .join(' ')
    .split(' ')
)
// A line break inside a paragraph, kept apart from the whitespace that is collapsed around it.
const BREAK = '\u2028'

const clean = (text) =>
  text
    .replace(/[^\S\u2028]+/g, ' ')
    .replace(/ ?\u2028 ?/g, BREAK)
    .trim()

// A backslash before what would start a heading, list, quote or rule at the start of a line. Only punctuation can be
// escaped, so a numbered line gets it before its dot.
const escapeLineStart = (line) =>
  line.replace(/^(\d+)([.)]\s)/, '$1\\$2').replace(/^(#{1,6}\s|[-+*]\s|>|-{3,}$|={3,}$)/, '\\$1')

// Page text with a backslash before what Markdown would read as markup: emphasis, code, links and HTML. An
// underscore inside a word, as in snake_case, is left alone, since it is not emphasis there.
const escapeText = (text) =>
  text.replace(/[\\`*[\]<]/g, '\\$&').replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')

// The paragraphs of a run of text as Markdown. Two line breaks in a row end a paragraph, as on pages that use <br><br>
// instead of <p>, and a single one stays a line break.
const paragraphs = (text) =>
  text
    .split(/\u2028{2,}/)
    .map((part) => part.split(BREAK).map(escapeLineStart).join('\n'))
    .filter(Boolean)

// Wraps the text between its leading and trailing spaces, so a marker never sits next to a space: "** a**" is not
// bold in Markdown.
function wrap(text, open, close = open) {
  const [, before, core, after] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  return core ? `${before}${open}${core}${close}${after}` : text
}

// Inline code in a run of backticks one longer than any inside it.
function code(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return text ? `${fence}${pad}${text}${pad}${fence}` : ''
}

const attr = (node, name) => node.attribs?.[name]

// A URL that cannot end a Markdown link early. Resolved URLs have no spaces, but parentheses stay as written.
const linkTarget = (url) => url.replaceAll('(', '%28').replaceAll(')', '%29')

function image(node, ctx) {
  const alt = attr(node, 'alt')
  const shownAlt = (alt ?? '').replace(/\s+/g, ' ').trim().replace(/[[\]]/g, '\\$&')
  const src = imageSrc((attr(node, 'src') ?? '').trim(), ctx.base)
  if (!src) return shownAlt
  // An image with no alt attribute at all is a different finding from one with alt="".
  return alt === undefined ? `![](${linkTarget(src)} "no alt attribute")` : `![${shownAlt}](${linkTarget(src)})`
}

// A link to another page keeps its address. Fragment links, mailto: and the like keep only their text.
function link(node, ctx) {
  const text = inlineChildren(node, ctx)
  const raw = (attr(node, 'href') ?? '').trim()
  const href = raw && !raw.startsWith('#') ? absolute(raw, ctx.base) : null
  if (!href || !/^https?:/.test(href)) return text
  return wrap(text, '[', `](${linkTarget(href)})`)
}

function inline(node, ctx) {
  if (node.type === 'text') return escapeText(node.data)
  if (!isElement(node) || ctx.skip.has(node.name)) return ''
  switch (node.name) {
    case 'br':
      return BREAK
    case 'img':
      return image(node, ctx)
    case 'a':
      return link(node, ctx)
    case 'strong':
    case 'b':
      return wrap(inlineChildren(node, ctx), '**')
    case 'em':
    case 'i':
      return wrap(inlineChildren(node, ctx), '*')
    case 'code':
    case 'kbd':
    case 'samp':
      return code(textContent(node).replace(/\s+/g, ' '))
    default:
      // A block on one line, such as a list item in a table cell, still stays apart from its neighbours.
      return INLINE.has(node.name) ? inlineChildren(node, ctx) : ` ${inlineChildren(node, ctx)} `
  }
}

const inlineChildren = (node, ctx) => (node.children ?? []).map((child) => inline(child, ctx)).join('')

// All text under a node, as written, scripts and styles included: only for code, where nothing is hidden.
const textContent = (node) =>
  node.type === 'text' ? node.data : (node.children ?? []).map((child) => textContent(child)).join('')

// The text of an element on one line, for headings and table cells.
const oneLine = (node, ctx) => clean(inlineChildren(node, ctx)).replaceAll(BREAK, ' ')

const indent = (text, prefix) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : `${prefix}${line}`))
    .join('\n')

function list(node, ctx) {
  const ordered = node.name === 'ol'
  let number = Number.parseInt(attr(node, 'start'), 10)
  if (!Number.isFinite(number)) number = 1
  const items = (node.children ?? [])
    .filter((child) => isElement(child) && child.name === 'li')
    .map((li) => {
      const marker = ordered ? `${number++}. ` : '- '
      const body = blocks(li.children, ctx).join('\n')
      return `${marker}${indent(body, ' '.repeat(marker.length))}`.trimEnd()
    })
  return items.length ? [items.join('\n')] : []
}

function preformatted(node) {
  const codeChild = (node.children ?? []).find((child) => isElement(child) && child.name === 'code')
  const classes = `${attr(node, 'class') ?? ''} ${attr(codeChild ?? {}, 'class') ?? ''}`
  const language = classes.match(/(?:^|\s)(?:language|lang)-([\w+#-]+)/)?.[1] ?? ''
  const text = textContent(node).replace(/^\n/, '').replace(/\s+$/, '')
  if (!text) return []
  const longest = Math.max(0, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}${language}\n${text}\n${fence}`]
}

// The rows of a table, not those of a table nested in one of its cells.
function rows(table) {
  const found = []
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (!isElement(child) || child.name === 'table') continue
      if (child.name === 'tr') found.push(child)
      else visit(child)
    }
  }
  visit(table)
  return found
}

const cellsOf = (row) =>
  (row.children ?? []).filter((cell) => isElement(cell) && (cell.name === 'td' || cell.name === 'th'))

const holds = (node, names) =>
  (node.children ?? []).some((child) => isElement(child) && (names.has(child.name) || holds(child, names)))
const STRUCTURE = new Set(['table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

// A table used to lay out the page rather than to hold data: marked as presentation, a single cell, or with a cell
// that holds a heading, another table or more than one paragraph.
const layoutTable = (node, cells, ctx) =>
  ['presentation', 'none'].includes(attr(node, 'role')) ||
  cells.length < 2 ||
  cells.some((cell) => holds(cell, STRUCTURE) || blocks(cell.children, ctx).length > 1)

// How many columns and rows a cell covers, within the limits HTML sets: colspan up to 1000, rowspan up to 65534 and
// never past the last row, which a rowspan of 0 runs to.
function span(cell, rowsLeft) {
  const number = (name, max) => Math.min(Math.max(Number.parseInt(attr(cell, name), 10) || 1, 1), max)
  const rows = attr(cell, 'rowspan')?.trim() === '0' ? rowsLeft : number('rowspan', 65534)
  return { cols: number('colspan', 1000), rows: Math.min(rows, rowsLeft) }
}

// The text of each cell placed in its row and column, a spanning cell repeated in every place it covers, so each
// value stays under its own header. A grid much larger than the cells it holds, from spans or very uneven rows,
// is null: written out it could grow with the square of the table.
function cellGrid(rowCells, ctx) {
  const limit = Math.max(64, 4 * rowCells.flat().length)
  const spans = rowCells.map((cells, r) => cells.map((cell) => span(cell, rowCells.length - r)))
  if (spans.flat().reduce((sum, { cols, rows }) => sum + cols * rows, 0) > limit) return null
  const grid = rowCells.map(() => [])
  rowCells.forEach((cells, r) => {
    let column = 0
    cells.forEach((cell, i) => {
      while (grid[r][column] !== undefined) column++
      const text = oneLine(cell, ctx).replaceAll('|', '\\|')
      const { cols, rows } = spans[r][i]
      for (let down = 0; down < rows; down++) {
        for (let across = 0; across < cols; across++) grid[r + down][column + across] = text
      }
      column += cols
    })
  })
  const width = Math.max(...grid.map((row) => row.length))
  if (width * grid.length > limit) return null
  return grid.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ''))
}

function pipeTable([head, ...body]) {
  const line = (row) => `| ${row.join(' | ')} |`
  return [line(head), `|${' --- |'.repeat(head.length)}`, ...body.map(line)].join('\n')
}

// A data table as a pipe table, a layout table as the blocks its cells hold, in order, since one table row per line
// would run a whole article together. A caption comes first, as browsers show it.
function table(node, ctx) {
  const caption = (node.children ?? [])
    .filter((child) => isElement(child) && child.name === 'caption')
    .flatMap((child) => labelled(child, ctx, '*'))
  const rowCells = rows(node)
    .map(cellsOf)
    .filter((row) => row.length)
  const cells = rowCells.flat()
  const grid = layoutTable(node, cells, ctx) ? null : cellGrid(rowCells, ctx)
  return [...caption, ...(grid ? [pipeTable(grid)] : cells.flatMap((cell) => blocks(cell.children, ctx)))]
}

const quote = (node, ctx) => {
  const text = blocks(node.children, ctx).join('\n\n')
  return text ? [text.replace(/^/gm, '> ').replace(/^> $/gm, '>')] : []
}

const heading = (node, ctx) => {
  const text = oneLine(node, ctx)
  return text ? [`${'#'.repeat(Number(node.name[1]))} ${text}`] : []
}

// Text marked as a label of its own, such as a figure caption or a term.
const labelled = (node, ctx, marker) => {
  const text = oneLine(node, ctx)
  return text ? [wrap(text, marker)] : []
}

const BLOCKS = {
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  ul: list,
  ol: list,
  pre: preformatted,
  table,
  blockquote: quote,
  hr: () => ['---'],
  figcaption: (node, ctx) => labelled(node, ctx, '*'),
  dt: (node, ctx) => labelled(node, ctx, '**'),
  summary: (node, ctx) => labelled(node, ctx, '**')
}

// Markdown blocks for a list of nodes. Text and inline elements between blocks form paragraphs; any element that is
// not inline, such as a <div> or a custom element, is walked into as a block of its own.
function blocks(nodes, ctx) {
  const out = []
  let run = ''
  const flush = () => {
    out.push(...paragraphs(clean(run)))
    run = ''
  }
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      run += escapeText(node.data)
    } else if (isElement(node) && !ctx.skip.has(node.name)) {
      if (INLINE.has(node.name)) {
        run += inline(node, ctx)
      } else {
        flush()
        // Only BLOCKS' own keys: an element named like an Object method, such as <constructor>, is walked into.
        const render = Object.hasOwn(BLOCKS, node.name) ? BLOCKS[node.name] : (n) => blocks(n.children, ctx)
        out.push(...render(node, ctx))
      }
    }
  }
  flush()
  return out
}

// YAML front matter. Strings are written as JSON, which is valid YAML, so a colon or quote in a title is safe.
function frontMatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`)
  return `---\n${lines.join('\n')}\n---`
}

// Marks a file as written by pageaudit, so a later run can replace it and leave other files alone.
const GENERATOR = 'pageaudit'
const START = `---\ngenerator: ${JSON.stringify(GENERATOR)}\n`

// True when `head`, the start of a file, is the start of one pageMarkdown() wrote.
export const writtenByPageaudit = (head) => head.startsWith(START)
export const HEAD_LENGTH = START.length

// The main content of a page as Markdown, after front matter that says which page it is and which part of it was
// read. The content is the HTML as served, before scripts run. `truncated` says the HTML was cut at 2 MB.
export function pageMarkdown($, { url, finalUrl, title, truncated = false }) {
  const { root, skip, area } = mainArea($)
  const body = blocks(root.children, { skip, base: baseUrl($, finalUrl) }).join('\n\n')
  const header = frontMatter({
    generator: GENERATOR,
    url,
    finalUrl,
    title,
    area,
    ...(truncated ? { truncated: true } : {})
  })
  return `${header}\n\n${body}\n`
}
