// The error a failed audit stores, as the worker and the restart recovery write it and GET /audits/:id answers it.
// The web pages word each one for their readers, so they compare against these rather than copies of the text.
export const AUDIT_ERROR = {
  fetchFailed: 'Could not fetch page',
  failed: 'Audit failed',
  interrupted: 'Audit was interrupted'
}
