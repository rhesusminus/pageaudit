const MAX_CONTEXT = 120;

// Caps an issue context so large markup or long attribute values never flood the report.
export function truncate(text) {
  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 3)}...` : text;
}

export function snippet($, el) {
  return truncate($.html(el));
}
