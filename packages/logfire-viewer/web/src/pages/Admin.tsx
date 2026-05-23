import React from 'react'
import { useEffect, useState } from 'react'

import type { AdminProject, AdminToken } from '../api'
import { api } from '../api'

export default function Admin(): React.JSX.Element {
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState('')

  async function refresh(): Promise<void> {
    try {
      const r = await api.admin.listProjects()
      setProjects(r.projects)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function createProject(): Promise<void> {
    setError(null)
    try {
      await api.admin.createProject({ slug: newSlug })
      setNewSlug('')
      setCreating(false)
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function removeProject(id: string): Promise<void> {
    if (!confirm('Delete this project? The data file will remain on disk unless purge is enabled.'))
      return
    try {
      await api.admin.deleteProject(id, false)
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Projects</h2>
      {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
      <div className="filter-bar">
        {creating ? (
          <>
            <input
              type="text"
              placeholder="new-project-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
            />
            <button onClick={() => void createProject()}>Create</button>
            <button onClick={() => setCreating(false)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setCreating(true)}>+ New project</button>
        )}
      </div>
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} onChange={() => void refresh()} onDelete={() => void removeProject(p.id)} />
      ))}
      {projects.length === 0 && <div className="empty">No projects.</div>}
    </div>
  )
}

function ProjectCard({
  project,
  onChange,
  onDelete,
}: {
  project: AdminProject
  onChange: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [tokens, setTokens] = useState<AdminToken[]>([])
  const [showTokens, setShowTokens] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenScopes, setNewTokenScopes] = useState('write,read')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retention, setRetention] = useState(project.retention_days)
  const [maxRows, setMaxRows] = useState(project.retention_max_rows)
  const [samplingRate, setSamplingRate] = useState(project.sampling_rate)
  const [rateRps, setRateRps] = useState(project.rate_limit_rps ?? '')
  const [rateBurst, setRateBurst] = useState(project.rate_limit_burst ?? '')

  async function loadTokens(): Promise<void> {
    try {
      const r = await api.admin.listTokens(project.id)
      setTokens(r.tokens)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function createToken(): Promise<void> {
    setError(null)
    try {
      const r = await api.admin.createToken(project.id, newTokenName || 'unnamed', newTokenScopes)
      setCreatedToken(r.token.plaintext)
      setNewTokenName('')
      void loadTokens()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function saveSettings(): Promise<void> {
    setError(null)
    try {
      await api.admin.updateProject(project.id, {
        retention_days: Number(retention),
        retention_max_rows: Number(maxRows),
        sampling_rate: Number(samplingRate),
        rate_limit_rps: rateRps === '' ? null : Number(rateRps),
        rate_limit_burst: rateBurst === '' ? null : Number(rateBurst),
      })
      onChange()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="tile" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{project.slug}</h3>
        <span style={{ color: 'var(--fg-dim)' }}>{project.id}</span>
        <span className="flex-spacer" />
        <button onClick={onDelete} style={{ color: 'var(--red)' }}>Delete</button>
      </div>
      {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
      <div className="kvs" style={{ marginTop: 8 }}>
        <span className="k">db_path</span><span className="v">{project.db_path}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 12 }}>
        <label>
          <div style={{ color: 'var(--fg-dim)' }}>Retention (days, 0 = forever)</div>
          <input type="number" value={retention} onChange={(e) => setRetention(Number(e.target.value))} />
        </label>
        <label>
          <div style={{ color: 'var(--fg-dim)' }}>Max rows per signal</div>
          <input type="number" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))} />
        </label>
        <label>
          <div style={{ color: 'var(--fg-dim)' }}>Sampling rate (0..1)</div>
          <input type="number" step="0.01" value={samplingRate} onChange={(e) => setSamplingRate(Number(e.target.value))} />
        </label>
        <label>
          <div style={{ color: 'var(--fg-dim)' }}>Rate limit (rps)</div>
          <input type="number" value={rateRps} onChange={(e) => setRateRps(e.target.value as never)} />
        </label>
        <label>
          <div style={{ color: 'var(--fg-dim)' }}>Burst</div>
          <input type="number" value={rateBurst} onChange={(e) => setRateBurst(e.target.value as never)} />
        </label>
      </div>
      <button onClick={() => void saveSettings()} style={{ marginTop: 8 }}>Save settings</button>

      <div style={{ marginTop: 16 }}>
        <button onClick={() => { setShowTokens((v) => !v); if (!showTokens) void loadTokens() }}>
          {showTokens ? 'Hide tokens' : 'Show tokens'}
        </button>
        {showTokens && (
          <div style={{ marginTop: 8 }}>
            <div className="filter-bar">
              <input
                type="text"
                placeholder="token name"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
              />
              <input
                type="text"
                placeholder="scopes (write,read)"
                value={newTokenScopes}
                onChange={(e) => setNewTokenScopes(e.target.value)}
              />
              <button onClick={() => void createToken()}>+ Create token</button>
            </div>
            {createdToken && (
              <div className="banner" style={{ background: 'var(--accent-dim)' }}>
                <div style={{ color: 'var(--fg-dim)', marginBottom: 4 }}>
                  Save this token — shown once:
                </div>
                <code className="code">{createdToken}</code>
                <button style={{ marginLeft: 8 }} onClick={() => {
                  void navigator.clipboard.writeText(createdToken)
                }}>
                  Copy
                </button>
                <button style={{ marginLeft: 4 }} onClick={() => setCreatedToken(null)}>
                  Dismiss
                </button>
              </div>
            )}
            <table>
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th /></tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td><code className="code">{t.token_prefix}…</code></td>
                    <td>{t.scopes}</td>
                    <td>{new Date(t.created_at_ms).toLocaleString()}</td>
                    <td>{t.last_used_at_ms ? new Date(t.last_used_at_ms).toLocaleString() : '—'}</td>
                    <td>
                      <button
                        onClick={async () => {
                          await api.admin.revokeToken(t.id)
                          void loadTokens()
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
