import { checkCanonicalTargets } from './canonical.js';
import { checkDuplicates } from './duplicates.js';

// Checks that compare pages, run once every page is audited. Site issues list
// the pages involved in `urls` instead of a single `url`.
export const checkSite = (pages) => [...checkDuplicates(pages), ...checkCanonicalTargets(pages)];
