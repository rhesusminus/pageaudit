// Plain-language wording for each issue type, for readers who are not SEO specialists.
// Every issue type the checks can produce needs an entry (test/html.test.js enforces it).
export const ADVICE = {
  'fetch-failed': {
    title: 'The page could not be reached',
    why: 'Visitors and search engines get nothing from this address, so it cannot appear in search results.',
    fix: 'Check that the address is correct and that the server is up, then run the audit again.'
  },
  'check-failed': {
    title: 'The page could not be checked',
    why: 'The page loaded, but the audit could not read its HTML, so none of the page checks ran and its problems are unknown.',
    fix: 'The message says what went wrong. Pass it on to whoever runs the audit.'
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
  'invalid-hreflang': {
    title: 'A language version uses a code search engines do not understand',
    why: 'Search engines ignore a language link whose code is not a real language, or region, code. A common mistake is en-UK instead of en-GB.',
    fix: 'Use a two-letter language code such as en, optionally followed by a two-letter country code such as en-GB, or x-default.'
  },
  'relative-hreflang': {
    title: 'A language version link is not a full URL',
    why: 'Google needs the complete address of every language version and may skip links that are relative or empty.',
    fix: 'Use the complete address, starting with https://, in every hreflang link.'
  },
  'duplicate-hreflang': {
    title: 'The same language is listed more than once',
    why: 'When one language points to two addresses, search engines cannot tell which one to show, and may ignore both.',
    fix: 'List each language once, with the one address that serves it.'
  },
  'missing-self-hreflang': {
    title: 'The language links leave out this page',
    why: 'Each language version should list every version, itself included. Without that, search engines may not trust the set.',
    fix: 'Add a hreflang link that points to this page, with its own language code.'
  },
  'missing-x-default': {
    title: 'The language links have no default version',
    why: 'This is optional. A default version tells search engines which page to show visitors whose language you do not offer.',
    fix: 'If one page suits everyone else, such as a language picker or your main language, add a hreflang link with x-default pointing to it.'
  },
  'hreflang-missing-return': {
    title: 'A language version does not link back',
    why: 'Search engines only trust a language link when both pages name each other. A one-way link is ignored.',
    fix: 'Add the missing hreflang link to the other page, so every language version lists all the others.'
  },
  'hreflang-target-noindex': {
    title: 'A language version is hidden from search',
    why: 'The page is linked as a language version, but it asks search engines not to list it, so it will not be shown to anyone.',
    fix: 'Remove the noindex from that page, or remove it from the language links.'
  },
  'hreflang-target-canonicalised': {
    title: 'A language version points its canonical elsewhere',
    why: 'The page is linked as a language version, but its canonical address names another page, which sends search engines mixed signals.',
    fix: 'Give every language version a canonical link pointing to itself, and use hreflang links between them.'
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
  'product-offer-incomplete': {
    title: 'Product markup lacks what a shopping result needs',
    why: 'Google shows a product with its price and stock in shopping results only when the markup gives an image, a price above 0 and its currency in an Offer.',
    fix: 'Add the fields named in the technical message to the Product markup, usually in the theme or the SEO app that writes it.'
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
  'form-input-no-label': {
    title: 'A form field has no label',
    why: 'Screen reader users hear only "edit text" and cannot tell what to enter. A placeholder is not a label, and clicking the label text cannot focus the field.',
    fix: 'Add a visible <label> linked to the field, or an aria-label where no visible text fits.'
  },
  'link-no-name': {
    title: 'A link has no name',
    why: 'A link with no text, or only an icon without a description, is announced as just "link", so screen reader users cannot tell where it goes.',
    fix: 'Give the link text, or an aria-label or an icon description that says where it goes.'
  },
  'link-generic-text': {
    title: 'Links say "click here" or "read more"',
    why: 'Screen reader users often browse a list of links on their own, where "read more" says nothing. Descriptive link text also helps search engines understand the target.',
    fix: 'Make the link text describe the target. If the surrounding text already makes it clear, you can leave it.'
  },
  'link-empty-href': {
    title: 'Links that go nowhere',
    why: 'A link with # or javascript: as its address is usually a button in disguise. It is announced as a link but does not behave like one, and search engines cannot follow it.',
    fix: 'Use a <button> for actions, or a real address for navigation. This can be fine for controls driven by scripts.'
  },
  'duplicate-id': {
    title: 'The same id is used more than once',
    why: 'Ids must be unique. When a label or ARIA attribute points at a duplicated id, browsers and screen readers pick the wrong element.',
    fix: 'Give each element its own id, and update any label or ARIA reference that points to it.'
  },
  'missing-main-landmark': {
    title: 'The page has no main area',
    why: 'A <main> element lets keyboard and screen reader users skip the header and menu and jump to the content.',
    fix: 'Wrap the main content of the page in a <main> element.'
  },
  'mixed-content': {
    title: 'A secure page loads something insecurely',
    why: 'Browsers block or rewrite files loaded over http on an https page, so images or scripts may be missing, and the padlock can be lost.',
    fix: 'Change the address of the file to https.'
  },
  'missing-hsts': {
    title: 'Browsers are not told to always use the secure address',
    why: 'Without the Strict-Transport-Security header, a visitor who types the address or follows an old http link makes the first request without encryption, where it can be intercepted.',
    fix: 'Ask your host or developer to send Strict-Transport-Security: max-age=31536000 on every https response, once the whole site works over https.'
  },
  'missing-x-content-type-options': {
    title: 'Browsers may guess the type of your files',
    why: 'Without X-Content-Type-Options: nosniff, a browser can treat an uploaded file as a script or page, which attackers can abuse.',
    fix: 'Ask your host or developer to send X-Content-Type-Options: nosniff on every response.'
  },
  'missing-clickjacking-protection': {
    title: 'Other sites can show your pages inside theirs',
    why: 'A page that can be framed by any site can be overlaid with fake buttons, tricking visitors into clicking things they did not mean to.',
    fix: "Send X-Frame-Options: SAMEORIGIN, or a Content-Security-Policy with frame-ancestors 'self', unless the page is meant to be embedded elsewhere."
  },
  'weak-csp': {
    title: 'The content security policy lets risky scripts run',
    why: 'A Content-Security-Policy limits what scripts can run if an attacker manages to inject code. One that allows inline scripts or eval stops little of that.',
    fix: "Move to a strict policy with a nonce or hash for each script, as web.dev describes, and remove 'unsafe-inline' and 'unsafe-eval' where you can."
  },
  'no-compression': {
    title: 'Pages are sent uncompressed',
    why: 'Compressed HTML is usually several times smaller, so the page starts loading sooner, especially on mobile connections.',
    fix: 'Turn on gzip or brotli compression for HTML in your server or hosting settings. Most hosts have a switch for it.'
  },
  'broken-link': {
    title: 'Links lead to pages that do not exist',
    why: 'Visitors who follow the link land on an error page instead of what they wanted, and Google wastes its visit on the site following a dead end.',
    fix: 'Point the link at the right page, or remove it. If the page moved, also redirect the old address to the new one.'
  },
  'link-target-unreachable': {
    title: 'A linked page did not load',
    why: 'The server answered with an error or did not answer in time. If it keeps happening, visitors and Google cannot reach the page through the link.',
    fix: 'Open the linked page and check that it loads. If it fails, ask your host or developer to look at the server errors.'
  },
  'link-to-redirect': {
    title: 'Links point to an old address that redirects',
    why: 'The link still works, but every click and every Google visit takes an extra step through the redirect before reaching the page.',
    fix: 'Change the link to point straight at the final address shown in the report.'
  },
  'orphan-page': {
    title: 'Pages that no other page links to',
    why: 'Visitors cannot reach these pages by clicking through the site, and Google finds them only through the sitemap, with no links telling it what the pages are about or how they relate to the rest of the site.',
    fix: 'Link to each page from a related page or the menu. If a page is no longer needed, remove it from the sitemap.'
  },
  'client-side-rendered': {
    title: "The page is built in the visitor's browser",
    why: 'The page code has almost no text, so the content appears only after scripts run. Google runs the scripts, but the crawlers of ChatGPT, Claude and Perplexity do not, so what the scripts build can be missing from what they read and from the AI answers they feed. This audit also only reads the code, so its results for this page may be incomplete.',
    fix: 'Render the important content on the server so it is in the page code. Google Search Console shows only how Google sees the page, not how AI crawlers do.'
  },
  'blocked-by-robots': {
    title: 'Search engines are told to stay away from the page',
    why: 'The robots.txt file of the site does not let Google crawl this page, so it cannot read it or rank it for what it says. That is right for private areas, but a problem on a page that should be found.',
    fix: 'If the page should appear in search, remove the matching Disallow rule from robots.txt. If not, no action is needed.'
  },
  'ai-search-blocked': {
    title: 'AI search tools are told to stay away from the page',
    why: 'The robots.txt file of the site lets Google crawl the page but not the crawlers that ChatGPT search, Claude or Perplexity use to find pages for their answers, so the page cannot be quoted or linked there. Some sites do this on purpose, others meant to block only the crawlers that collect training data.',
    fix: 'If the page should be found through AI search, remove the Disallow rule for the crawler named in the finding (OAI-SearchBot, Claude-SearchBot or PerplexityBot). To keep the content out of AI training only, block GPTBot, ClaudeBot and Google-Extended instead.'
  },
  'snippet-restricted': {
    title: 'Google may quote little or nothing from the page',
    why: 'A nosnippet or max-snippet rule in the robots meta tag or the X-Robots-Tag header limits the text Google shows under the page in search results. The same rule limits how much of the page AI Overviews and AI Mode can use, and with nosnippet or max-snippet:0 they cannot use its text at all.',
    fix: 'If the page should be quoted in search and AI answers, remove nosnippet, or raise max-snippet or set it to -1 for no limit. To hide only some parts, such as a price that changes, wrap them in an element with data-nosnippet instead.'
  },
  'copilot-restricted': {
    title: 'Bing is told to keep the page out of Copilot answers',
    why: 'Bing reads noarchive as "do not use this page in Copilot answers" and nocache as "show only its title, address and snippet". Google no longer uses noarchive at all, so the rule is often left over from old cache settings and now only costs visibility in Copilot.',
    fix: 'If the page should be used in Copilot answers, remove noarchive and nocache from the robots meta tag (or a bingbot one) and from the X-Robots-Tag header.'
  },
  'robots-txt-unreachable': {
    title: 'The robots.txt file could not be read',
    why: 'The server answered with an error when asked for robots.txt. Google pauses crawling a site while it cannot read the file, and gives up on it after a while.',
    fix: 'Make the server return the robots.txt file, or a plain "not found" if the site has none. Ask your host if the error keeps coming back.'
  },
  'robots-txt-failed': {
    title: 'The robots.txt file could not be fetched',
    why: 'The request for robots.txt failed, for example by timing out, while the pages themselves loaded. This audit could not tell whether the file blocks any of them, and Google may have trouble reading it too.',
    fix: 'Check that the server answers requests for robots.txt reliably, then run the audit again. Ask your host if it keeps failing.'
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
  'sitemap-too-many-urls': {
    title: 'A sitemap lists too many addresses',
    why: 'Google accepts at most 50,000 addresses in one sitemap file. A larger file is rejected, so none of its pages are submitted this way.',
    fix: 'Split the sitemap into several files of fewer than 50,000 addresses and list them in a sitemap index.'
  },
  'sitemap-too-large': {
    title: 'A sitemap file is too large',
    why: 'Google accepts sitemap files of at most 50 MB uncompressed. A larger file is rejected, so none of its pages are submitted this way.',
    fix: 'Split the sitemap into several smaller files and list them in a sitemap index.'
  },
  'sitemap-empty-loc': {
    title: 'A sitemap has entries without an address',
    why: 'Each entry needs the full address of a page. Entries without one are ignored, so the page they were meant for is not submitted.',
    fix: 'Fill in the address of each entry, or remove the empty ones. This is usually a bug in the tool that generates the sitemap.'
  },
  'sitemap-loc-relative': {
    title: 'A sitemap lists addresses without the site name',
    why: 'Sitemap addresses must be complete, starting with https:// and the site name. A path such as /about is not understood.',
    fix: 'Write every address in full, for example https://www.example.com/about.'
  },
  'sitemap-loc-malformed': {
    title: 'A sitemap lists addresses that are broken',
    why: 'Some addresses, such as https:// with no site name, cannot be read as a web address. Search engines ignore these entries.',
    fix: 'Correct or remove these entries. This is usually a bug in the tool that generates the sitemap.'
  },
  'sitemap-loc-not-http': {
    title: 'A sitemap lists addresses that are not web pages',
    why: 'Sitemaps can only list http and https addresses. Others, such as ftp: or mailto:, are ignored.',
    fix: 'Remove these entries, or replace them with the https address of the page.'
  },
  'sitemap-duplicate-loc': {
    title: 'A sitemap lists the same address more than once',
    why: 'The repeats add size to the file and nothing else. They are usually a sign the sitemap is generated from more than one source.',
    fix: 'List each address once.'
  },
  'sitemap-invalid-lastmod': {
    title: 'A sitemap has dates in the wrong format',
    why: 'Last-modified dates must be written like 2026-03-31 or 2026-03-31T10:00:00+00:00. Google ignores dates it cannot read, so it cannot tell which pages changed.',
    fix: 'Write the dates in the W3C format, or remove them. Only keep them if they are accurate.'
  },
  'sitemap-off-host': {
    title: 'A sitemap lists pages on another site',
    why: 'A sitemap may only list pages on its own site, unless the other site has agreed to it. Without that, search engines ignore those entries.',
    fix: 'Add a Sitemap line with the address of this file to the robots.txt of the other site, or submit it for that site in Search Console. If neither is wanted, remove the entries.'
  },
  'no-sitemap-declared': {
    title: 'robots.txt does not point to a sitemap',
    why: 'A Sitemap line in robots.txt is the standard way for search engines to find your sitemap, also those you have not submitted it to by hand.',
    fix: 'Add a line such as Sitemap: https://www.example.com/sitemap.xml to robots.txt.'
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
