// Browsers and Google collapse whitespace runs, so measure and display text the same way.
export const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim();
