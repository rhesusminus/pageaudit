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
  'missing-open-graph': {
    title: 'Links to the page get a plain preview when shared',
    why: 'Without Open Graph tags, social and chat apps guess the preview title, text and picture. This does not affect Google rankings.',
    fix: 'Add og:title, og:description and og:image tags so shared links look good.'
  },
  'incomplete-open-graph': {
    title: 'The preview for shared links is incomplete',
    why: 'Some Open Graph tags are set but others are missing, so social and chat apps fill the gaps with guesses.',
    fix: 'Add the missing tags listed in the technical message. A picture of about 1200 by 630 pixels works well.'
  },
  'missing-twitter-card': {
    title: 'No card type for shared links on X',
    why: 'X falls back to the Open Graph tags, but without a card type it picks the layout itself, often a small preview.',
    fix: 'Add a twitter:card tag, for example summary_large_image.'
  },
  noindex: {
    title: 'The page asks search engines to stay away',
    why: 'A noindex tag keeps the page out of search results. That is right for pages like thank-you or login pages, but a disaster on a page that should be found.',
    fix: 'If the page should appear in search, remove the noindex directive. If not, no action is needed.'
  },
  nofollow: {
    title: 'The page asks search engines not to follow its links',
    why: 'Search engines will not pass value or discover other pages through the links on this page.',
    fix: 'Remove nofollow from the robots tag unless this is on purpose.'
  },
  'missing-viewport': {
    title: 'The page is not set up for phones',
    why: 'Without a viewport tag, phones show the page at desktop width and shrink it, so text is tiny and visitors have to zoom.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head of the page.'
  },
  'missing-lang': {
    title: 'The page does not say what language it is in',
    why: 'Screen readers use the language to pick the right voice, and browsers use it to offer translation.',
    fix: 'Add a lang attribute to the html tag, for example lang="en" or lang="fi".'
  },
  'invalid-json-ld': {
    title: 'Structured data on the page is broken',
    why: 'The structured data cannot be read, so search engines ignore it and the page loses its chance of rich results.',
    fix: "Fix the JSON syntax (the technical message names the problem) and test it with Google's Rich Results Test."
  },
  'json-ld-missing-context': {
    title: 'Structured data is missing its vocabulary',
    why: 'Without @context, search engines do not know which vocabulary the markup uses and may ignore it.',
    fix: 'Add "@context": "https://schema.org" to the structured data.'
  },
  'json-ld-relative-url': {
    title: 'Structured data uses a partial web address',
    why: 'Addresses in structured data should be complete, with https and the domain, or search engines may not resolve them.',
    fix: 'Replace the relative address with the full one, for example https://example.com/logo.png.'
  },
  'unsupported-schema-type': {
    title: 'Structured data that Google no longer shows',
    why: 'Google does not show a rich result for this type, so the markup has no visible effect in Google Search. It does no harm.',
    fix: 'No action needed. You may remove it to keep the page lean, or keep it if other tools use it.'
  },
  'missing-schema-property': {
    title: 'Structured data is missing a required field',
    why: 'Google needs certain fields before it can show a rich result such as price or breadcrumbs, so the page is not eligible without them.',
    fix: 'Add the field named in the technical message to the structured data.'
  },
  'long-url': {
    title: 'The web address is long',
    why: 'Long addresses are harder to read, share and remember. Google has no strict limit.',
    fix: 'Shorten the address where you can, and drop parameters that do not change the content.'
  },
  'url-underscores': {
    title: 'The web address uses underscores',
    why: 'Google reads hyphens as word separators and recommends them over underscores.',
    fix: 'Use hyphens in new addresses. Only change existing ones if you set up a redirect from the old one.'
  },
  'url-uppercase': {
    title: 'The web address has capital letters',
    why: 'Google treats /Shop and /shop as different pages, which can split the page into duplicates.',
    fix: 'Use lowercase addresses and redirect any capitalised version to the lowercase one.'
  },
  'html-too-large': {
    title: 'The page code is very large',
    why: 'Google only reads the first 2 MB of a page. Content and structured data after that point is not indexed.',
    fix: 'Move inline scripts, styles and images out into separate files and trim the page markup.'
  },
  'mixed-content': {
    title: 'A secure page loads something insecurely',
    why: 'Browsers block or rewrite files loaded over http on an https page, so images or scripts may be missing, and the padlock can be lost.',
    fix: 'Change the address of the file to https.'
  },
  'client-side-rendered': {
    title: "The page is built in the visitor's browser",
    why: 'The page code has almost no text, so the content appears only after scripts run. Some search engines and tools see an empty page, and this audit only reads the code, so its results for this page may be incomplete.',
    fix: 'Render the important content on the server so it is in the page code, or check how the page looks in Google Search Console.'
  },
  'blocked-by-robots': {
    title: 'Search engines are told to stay away from the page',
    why: 'The robots.txt file of the site does not let Google crawl this page, so it cannot read it or rank it for what it says. That is right for private areas, but a problem on a page that should be found.',
    fix: 'If the page should appear in search, remove the matching Disallow rule from robots.txt. If not, no action is needed.'
  },
  'robots-txt-unreachable': {
    title: 'The robots.txt file could not be read',
    why: 'The server answered with an error when asked for robots.txt. Google pauses crawling a site while it cannot read the file, and gives up on it after a while.',
    fix: 'Make the server return the robots.txt file, or a plain "not found" if the site has none. Ask your host if the error keeps coming back.'
  },
  'sitemap-url-noindex': {
    title: 'The sitemap lists a page that asks not to be indexed',
    why: 'A sitemap says "please index these pages", while the pages themselves say "do not index me". Search engines get contradicting signals and may distrust the sitemap.',
    fix: 'Remove the page from the sitemap, or remove the noindex if it should be found.'
  },
  'sitemap-url-not-canonical': {
    title: 'The sitemap lists a page that points to another address',
    why: 'The sitemap should list the preferred address of each page. This page says its preferred address is a different one, so the sitemap lists a duplicate.',
    fix: 'List the address named as canonical on the page instead, and remove this one from the sitemap.'
  },
  'sitemap-url-redirects': {
    title: 'The sitemap lists an address that redirects',
    why: 'Search engines have to follow the redirect to reach the page, which wastes a request for every listed address.',
    fix: 'List the final address of the page in the sitemap instead.'
  },
  'lcp-slow': {
    title: 'The main content appears slowly',
    why: 'The largest element on the screen takes long to show, so visitors wait and may leave. Speed also counts as a search ranking signal. This number comes from a lab test on one machine, so it varies a little between runs.',
    fix: 'Make the largest image or text block load sooner: shrink and compress the image, serve it in a modern format, load it first and avoid blocking scripts and styles above it.'
  },
  'cls-high': {
    title: 'The page jumps around while loading',
    why: 'Content that shifts as it loads makes visitors click the wrong thing. This number comes from a lab test on one machine, so it varies a little between runs.',
    fix: 'Give images, videos and embeds a width and height, reserve room for ads and banners, and avoid inserting content above what is already shown.'
  },
  'tbt-high': {
    title: 'The page is slow to react while loading',
    why: 'Heavy scripts keep the page busy, so taps and clicks feel stuck for a moment. This number comes from a lab test on one machine, so it varies a little between runs.',
    fix: 'Remove scripts that are not needed, split large ones and load the rest later.'
  },
  'score-low-performance': {
    title: 'The page scores low on speed',
    why: 'A low speed score means the page loads slowly for visitors. The score comes from a lab test on one machine, so it varies a little between runs.',
    fix: 'Start with the biggest opportunities listed for this page in the speed and quality test.'
  },
  'score-low-accessibility': {
    title: 'The page scores low on accessibility',
    why: 'Parts of the page are hard or impossible to use with a screen reader, a keyboard or low vision. The score is from one automatic test, which finds only part of the problems.',
    fix: 'Work through the failed accessibility checks listed for this page, such as contrast, labels and missing text for images.'
  },
  'score-low-best-practices': {
    title: 'The page scores low on best practices',
    why: 'The page uses outdated or unsafe web techniques, which can cause errors and security problems.',
    fix: 'Work through the failed best practice checks listed for this page.'
  },
  'score-low-seo': {
    title: 'The page scores low on search basics',
    why: 'The page misses basics that search engines look for, so it may be harder to find.',
    fix: 'Work through the failed search checks listed for this page.'
  },
  'lighthouse-failed': {
    title: 'The speed and quality test could not run',
    why: 'The scores for this page are missing from the report. The other checks still ran.',
    fix: 'Check that Chrome is installed on the machine running the audit and run it again.'
  }
}

// Falls back to the technical message so an issue without wording is never hidden.
export const adviceFor = (type) => ADVICE[type] ?? null
