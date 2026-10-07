import { SOURCES } from '../../sources.js'
import { withEvidence } from '../evidence.js'
import { snippet } from '../snippet.js'

const GENERIC_NAME = /^(img|image|pic|picture|photo|dsc|dscn|untitled|screenshot)[-_ ]?\d*$/i

function fileName(src) {
  if (!src || src.startsWith('data:')) return ''
  const last = src.split(/[?#]/)[0].split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

// True when the image is the only content of a link/button, so an empty alt leaves it with no accessible name.
function isOnlyLinkContent($, el) {
  const link = $(el).closest('a, button')
  if (!link.length) return false
  if (link.attr('aria-label') || link.attr('aria-labelledby') || link.attr('title')) return false
  if (link.text().trim()) return false
  const images = link.find('img').toArray()
  return images[0] === el && images.every((img) => ($(img).attr('alt') ?? '').trim() === '')
}

function checkAlt($, el, alt) {
  if (alt === undefined) {
    return [
      {
        type: 'missing-alt',
        severity: 'error',
        category: 'accessibility',
        source: SOURCES.decorativeImages,
        message: 'Image missing alt attribute'
      }
    ]
  }
  if (alt.trim() !== '') return []
  if (isOnlyLinkContent($, el)) {
    return [
      {
        type: 'empty-alt-in-link',
        severity: 'error',
        category: 'accessibility',
        source: SOURCES.decorativeImages,
        message: 'Image is the only content of a link/button but has empty alt'
      }
    ]
  }
  return [
    {
      type: 'empty-alt',
      severity: 'info',
      category: 'accessibility',
      source: SOURCES.decorativeImages,
      message: 'Image has empty alt (correct if decorative, review)'
    }
  ]
}

function checkSrc(img, src) {
  if (src || img.attr('srcset')) return []
  return [
    {
      type: 'missing-src',
      severity: 'warning',
      category: 'seo',
      source: SOURCES.googleImages,
      message: 'Image has no src or srcset (Google finds images via src)'
    }
  ]
}

function checkFileName(src, alt) {
  const name = fileName(src)
  if (!name) return []
  const issues = []
  const stem = name.replace(/\.[a-z0-9]+$/i, '')
  if (GENERIC_NAME.test(stem)) {
    issues.push({
      type: 'generic-filename',
      severity: 'info',
      category: 'seo',
      source: SOURCES.googleImages,
      message: `Generic image file name "${name}" (use a short descriptive name)`
    })
  }
  const altText = (alt ?? '').trim().toLowerCase()
  if (altText && (altText === name.toLowerCase() || altText === stem.toLowerCase())) {
    issues.push({
      type: 'alt-is-filename',
      severity: 'warning',
      category: 'accessibility',
      source: SOURCES.googleImages,
      message: 'Alt text repeats the file name instead of describing the image'
    })
  }
  return issues
}

function checkDimensions(img) {
  if (img.attr('width') !== undefined && img.attr('height') !== undefined) return []
  return [
    {
      type: 'missing-dimensions',
      severity: 'warning',
      category: 'performance',
      source: SOURCES.cls,
      message: 'Image missing width/height (causes layout shift)'
    }
  ]
}

export function checkImages($) {
  const issues = []
  $('img').each((_, el) => {
    const img = $(el)
    const alt = img.attr('alt')
    const src = (img.attr('src') ?? '').trim()
    const found = [...checkAlt($, el, alt), ...checkSrc(img, src), ...checkFileName(src, alt), ...checkDimensions(img)]
    if (!found.length) return
    const context = snippet($, el)
    issues.push(
      ...withEvidence(
        $,
        el,
        found.map((issue) => ({ context, ...issue }))
      )
    )
  })
  return issues
}
