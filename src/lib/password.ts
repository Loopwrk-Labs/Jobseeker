// Password hashing with WebCrypto PBKDF2 — no npm dependency, works natively
// in the Workers runtime. Format stored in users.password_hash:
//   pbkdf2$<iterations>$<salt-base64>$<hash-base64>

// NOTE: Workers Free plan caps CPU time at 10ms/request (no limit in `wrangler dev`,
// which is why this only broke in production). 210k was OWASP's 2023 recommendation
// but blew that budget. 100k is still a reasonable PBKDF2-SHA256 cost for an internal
// 2-5 user tool; raise it back if/when the account moves to Workers Paid (30s CPU budget).
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(
    atob(b64)
      .split('')
      .map((c) => c.charCodeAt(0)),
  );
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt.buffer)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  if (!iterations || salt.length === 0 || expected.length === 0) return false;

  const actual = new Uint8Array(await deriveKey(password, salt, iterations));
  if (actual.length !== expected.length) return false;

  // Constant-time compare to avoid timing side-channels.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    // Still run a comparison of equal length to keep timing constant-ish.
    let diff = 1;
    for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ (bBytes[i % bBytes.length] || 0);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
