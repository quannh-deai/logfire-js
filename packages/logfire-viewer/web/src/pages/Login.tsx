import React from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { setAdminToken, setProjectToken } from '../auth'

export default function Login(): React.JSX.Element {
  const nav = useNavigate()
  const [tokenValue, setTokenValue] = useState('')
  const [mode, setMode] = useState<'project' | 'admin'>('project')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const trimmed = tokenValue.trim()
    if (!trimmed) {
      setError('Token is required.')
      return
    }
    if (mode === 'admin') {
      setAdminToken(trimmed)
      setProjectToken(null)
      // Probe the admin endpoint to validate.
      const r = await fetch('/api/admin/projects', { headers: { authorization: trimmed } })
      if (!r.ok) {
        setAdminToken(null)
        setError('Invalid admin token.')
        return
      }
      nav('/admin', { replace: true })
    } else {
      setProjectToken(trimmed)
      setAdminToken(null)
      const r = await fetch('/api/spans?limit=1', { headers: { authorization: trimmed } })
      if (!r.ok) {
        setProjectToken(null)
        setError('Invalid project token.')
        return
      }
      nav('/', { replace: true })
    }
  }

  return (
    <div className="login">
      <h2>Log in</h2>
      <p style={{ color: 'var(--fg-dim)' }}>
        Enter your project token to browse data, or the admin token to manage projects.
      </p>
      <form onSubmit={submit}>
        <label>
          <input
            type="radio"
            checked={mode === 'project'}
            onChange={() => setMode('project')}
          />
          Project token
        </label>
        <label style={{ marginLeft: 12 }}>
          <input type="radio" checked={mode === 'admin'} onChange={() => setMode('admin')} />
          Admin token
        </label>
        <input
          type="password"
          placeholder="lfv_..."
          value={tokenValue}
          onChange={(e) => setTokenValue(e.target.value)}
        />
        {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
        <button type="submit">Log in</button>
      </form>
    </div>
  )
}
