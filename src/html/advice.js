// Plain-language wording for each issue type, for readers who are not SEO specialists.
// Every issue type the checks can produce needs an entry (test/html.test.js enforces it).
export const ADVICE = {
  'fetch-failed': {
    title: 'The page could not be reached',
    why: 'Visitors and search engines get nothing from this address, so it cannot appear in search results.',
    fix: 'Check that the address is correct and that the server is up, then run the audit again.'
  },
  'http-status': {
    title: 'The page returns an error',
    why: 'Search engines ignore the content of pages that answer with an error, and visitors see an error page.',
    fix: 'Restore the page, or redirect the old address to the page that replaced it. Remove links that point here.'
  },
  'not-html': {
    title: 'The address is not a web page',
    why: 'It is a file such as a PDF or an image. That is fine on its own, but the page checks do not apply to it.',
    fix: 'No action needed unless this address was meant to be a normal page.'
  },
  redirect: {
    title: 'The address redirects',
    why: 'Each redirect adds a small delay. The final page was audited instead.',
    fix: 'Link to the final address directly where you can.'
  },
  'redirect-chain': {
    title: 'The address redirects more than once',
    why: 'Every extra hop slows the page down and can lose some of the value search engines pass along links.',
    fix: 'Point links and redirects straight at the final address.'
  },
  'missing-title': {
    title: 'The page has no title',
    why: 'The title is the headline people see in search results and browser tabs. Without it search engines make one up.',
    fix: 'Add a short, specific title that says what the page is about.'
  },
  'empty-title': {
    title: 'The page title is empty',
    why: 'An empty title gives people and search engines nothing to go on.',
    fix: 'Write a short, specific title that says what the page is about.'
  },
  'long-title': {
    title: 'The title is long',
    why: 'Long titles get cut off in search results, so the end of the message is lost.',
    fix: 'Shorten it to about 60 characters and put the most important words first.'
  },
  'missing-description': {
    title: 'The page has no meta description',
    why: 'The description is the text under the title in search results. Without it, search engines pick a snippet that may not sell the page.',
    fix: 'Write one or two sentences, about 70 to 160 characters, that tell people why to click.'
  },
  'short-description': {
    title: 'The meta description is very short',
    why: 'A very short description wastes the space search results give you to explain the page.',
    fix: 'Expand it to a clear sentence or two, about 70 to 160 characters.'
  },
  'long-description': {
    title: 'The meta description is long',
    why: 'Search results cut long descriptions off, so the end is not seen.',
    fix: 'Tighten it to about 160 characters, with the key message first.'
  },
  'multiple-descriptions': {
    title: 'The page has several meta descriptions',
    why: 'Only one is used, and it is not always the one you wanted.',
    fix: 'Keep a single meta description tag.'
  },
  'missing-canonical': {
    title: 'The page has no canonical address',
    why: 'When the same page can be reached at several addresses, search engines have to guess which one to list.',
    fix: 'Add a canonical link in the page head that points to the preferred address of this page.'
  },
  'multiple-canonicals': {
    title: 'The page names more than one canonical address',
    why: 'Conflicting signals make search engines ignore the hint or pick the wrong address.',
    fix: 'Keep a single canonical link in the page head.'
  },
  'relative-canonical': {
    title: 'The canonical address is not a full URL',
    why: 'Search engines can misread a relative canonical address, especially when the page is reachable at several addresses.',
    fix: 'Use the complete address, starting with https://.'
  },
  'canonical-fragment': {
    title: 'The canonical address contains a # part',
    why: 'Search engines generally ignore everything after the # in an address.',
    fix: 'Remove the # part from the canonical link.'
  },
  'empty-canonical': {
    title: 'The canonical link is empty',
    why: 'An empty canonical link tells search engines nothing.',
    fix: 'Put the page address in it, or remove the tag.'
  },
  'canonical-elsewhere': {
    title: 'The page points to a different canonical address',
    why: 'This is often intentional, for example for filtered lists. It means search engines will list the other address instead of this one.',
    fix: 'Check that this is what you want. If this page should be listed itself, point its canonical link at itself.'
  },
  'missing-h1': {
    title: 'The page has no main heading',
    why: 'A main heading tells visitors, and people using screen readers, what the page is about at a glance.',
    fix: 'Add one clear main heading near the top of the page.'
  },
  'multiple-h1': {
    title: 'The page has several main headings',
    why: 'Search engines cope with this, but one main heading is the clearest structure for visitors and screen readers.',
    fix: 'Keep one main heading and make the others subheadings.'
  },
  'skipped-heading-level': {
    title: 'Headings skip a level',
    why: 'Screen reader users move around a page by its headings, and a jump from a main heading to a small one breaks that outline.',
    fix: 'Use heading levels in order, without skipping, and style them with CSS instead of changing the level.'
  },
  'empty-heading': {
    title: 'A heading has no text',
    why: 'Screen readers announce an empty heading with nothing to read, which confuses visitors.',
    fix: 'Add text to the heading, or remove it if it is only there for spacing.'
  },
  'missing-alt': {
    title: 'Images have no description',
    why: 'People who cannot see the image, and search engines, have no idea what it shows.',
    fix: 'Add a short description of what the image shows. For purely decorative images, add an empty description on purpose.'
  },
  'empty-alt-in-link': {
    title: 'A linked image has no description',
    why: 'When an image is the only content of a link or button, an empty description leaves the link without a name for screen reader users.',
    fix: 'Describe where the link goes or what the button does.'
  },
  'empty-alt': {
    title: 'Images are marked as decorative',
    why: 'This is correct for pure decoration, but only a person can tell if an image is decorative.',
    fix: 'Check that these images really add no information. If one does, describe it.'
  },
  'alt-is-filename': {
    title: 'Image descriptions repeat the file name',
    why: 'A file name such as IMG_2031.jpg tells nobody what the image shows.',
    fix: 'Replace it with a short description of the image.'
  },
  'missing-src': {
    title: 'An image has no source',
    why: 'The image cannot be shown or found by search engines.',
    fix: 'Add the image address, or remove the empty image tag.'
  },
  'generic-filename': {
    title: 'Images have generic file names',
    why: 'Search engines use file names as a hint about an image. Names such as IMG00023.jpg say nothing.',
    fix: 'Rename the files to describe the image, for example blue-running-shoes.jpg.'
  },
  'missing-dimensions': {
    title: 'Images have no set size',
    why: 'The page jumps around as images load, which is annoying to read and hurts the layout stability score.',
    fix: 'Add width and height to each image so the browser can reserve the space.'
  },
  'duplicate-title': {
    title: 'Several pages share the same title',
    why: 'Search engines and visitors cannot tell the pages apart in search results.',
    fix: 'Give each page its own title.'
  },
  'duplicate-description': {
    title: 'Several pages share the same meta description',
    why: 'Identical descriptions make the pages look identical in search results.',
    fix: 'Write a description that is specific to each page.'
  },
  'duplicate-h1': {
    title: 'Several pages share the same main heading',
    why: 'Pages with the same heading are hard to tell apart for visitors and search engines.',
    fix: 'Give each page a heading that describes its own content.'
  },
  'lighthouse-failed': {
    title: 'The speed and quality test could not run',
    why: 'The scores for this page are missing from the report. The other checks still ran.',
    fix: 'Check that Chrome is installed on the machine running the audit and run it again.'
  }
}

// Falls back to the technical message so an issue without wording is never hidden.
export const adviceFor = (type) => ADVICE[type] ?? null
