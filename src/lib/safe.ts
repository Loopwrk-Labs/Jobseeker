/**
 * A `back` value from a form is only trusted when it is a same-site path:
 * starts with a single "/" (not "//host" or "/\host", which browsers treat as
 * another site) and has no control characters.
 */
export function safeBack(v: unknown, fallback: string): string {
  const b = typeof v === 'string' ? v.trim() : '';
  if (!b || b[0] !== '/' || b[1] === '/' || b[1] === '\\') return fallback;
  if (/[\u0000-\u001f\u007f]/.test(b)) return fallback;
  return b;
}
