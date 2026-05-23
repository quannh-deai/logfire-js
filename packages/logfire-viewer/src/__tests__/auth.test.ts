import { describe, expect, test } from 'vitest'

import { extractToken } from '../auth/middleware.js'
import { generateToken, hashToken, verifyToken } from '../auth/tokens.js'

describe('tokens', () => {
  test('generateToken produces verifiable token', () => {
    const { plaintext, storedHash, prefix } = generateToken()
    expect(plaintext.startsWith('lfv_')).toBe(true)
    expect(prefix.length).toBe(12)
    expect(verifyToken(plaintext, storedHash)).toBe(true)
    expect(verifyToken('lfv_wrong', storedHash)).toBe(false)
  })

  test('hashToken / verifyToken roundtrip', () => {
    const stored = hashToken('hello')
    expect(verifyToken('hello', stored)).toBe(true)
    expect(verifyToken('world', stored)).toBe(false)
  })

  test('verifyToken rejects malformed stored format', () => {
    expect(verifyToken('any', 'plain-text')).toBe(false)
    expect(verifyToken('any', 'scrypt:zz:zz')).toBe(false)
  })
})

describe('extractToken', () => {
  test('strips Bearer prefix', () => {
    expect(extractToken('Bearer lfv_abc')).toBe('lfv_abc')
    expect(extractToken('bearer  lfv_abc')).toBe('lfv_abc')
  })

  test('returns bare token unchanged', () => {
    expect(extractToken('lfv_xyz')).toBe('lfv_xyz')
  })

  test('empty/null', () => {
    expect(extractToken(null)).toBe('')
    expect(extractToken(undefined)).toBe('')
    expect(extractToken('')).toBe('')
  })
})
