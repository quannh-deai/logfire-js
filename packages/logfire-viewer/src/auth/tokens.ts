import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const TOKEN_BYTES = 32
const SCRYPT_KEYLEN = 32
const SCRYPT_SALT_BYTES = 16
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

export interface GeneratedToken {
  /** Plain-text token; show to user once, then discard. */
  plaintext: string
  /** Short visible prefix stored for UI display (`lfv_xxxxxxxx`). */
  prefix: string
  /** Stored verifier: `scrypt:<saltHex>:<hashHex>`. */
  storedHash: string
}

export function generateToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES).toString('hex')
  const plaintext = `lfv_${raw}`
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    storedHash: hashToken(plaintext),
  }
}

export function hashToken(plaintext: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const hash = scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyToken(plaintext: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1]!, 'hex')
  const expected = Buffer.from(parts[2]!, 'hex')
  if (salt.length === 0 || expected.length === 0) return false
  let actual: Buffer
  try {
    actual = scryptSync(plaintext, salt, expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/** Cheap stable key for the in-memory LRU. */
export function fingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}
