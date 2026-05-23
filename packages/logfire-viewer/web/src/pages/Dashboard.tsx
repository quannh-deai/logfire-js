import React from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { StatsResponse } from '../api'
import { api } from '../api'
import { levelLabel } from '../lib/levels'

export default function Dashboard(): React.JSX.Element {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>
  if (!stats) return <div>Loading…</div>

  const maxServiceCount = Math.max(1, ...stats.byService.map((s) => s.count))

  return (
    <div>
      <div className="tile-grid">
        <div className="tile">
          <div className="label">Spans</div>
          <div className="value">{stats.totals.spans.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Traces</div>
          <div className="value">{stats.totals.traces.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Logs</div>
          <div className="value">{stats.totals.logs.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Errors</div>
          <div className="value" style={{ color: stats.errorCount > 0 ? 'var(--red)' : undefined }}>
            {stats.errorCount.toLocaleString()}
          </div>
          <div style={{ color: 'var(--fg-dim)', fontSize: 12 }}>
            {(stats.errorRate * 100).toFixed(2)}% error rate
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="tile">
          <h3 style={{ marginTop: 0 }}>Top services</h3>
          {stats.byService.length === 0 ? (
            <div className="empty">No data.</div>
          ) : (
            stats.byService.map((s) => (
              <div key={s.service ?? 'unknown'} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.service ?? '(unknown)'}</span>
                  <span style={{ color: 'var(--fg-dim)' }}>{s.count}</span>
                </div>
                <div style={{ background: 'var(--bg-elev-2)', height: 6, borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${(s.count / maxServiceCount) * 100}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="tile">
          <h3 style={{ marginTop: 0 }}>By level</h3>
          {stats.byLevel.length === 0 ? (
            <div className="empty">No data.</div>
          ) : (
            stats.byLevel.map((l) => (
              <div
                key={l.level ?? 'null'}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
              >
                <span>{levelLabel(l.level) || '(none)'}</span>
                <span style={{ color: 'var(--fg-dim)' }}>{l.count}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="tile" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Slowest spans</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Service</th>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {stats.slowest.map((s) => (
              <tr key={s.span_id}>
                <td>{new Date(s.start_time_ms).toLocaleString()}</td>
                <td>{s.service_name ?? ''}</td>
                <td>
                  <Link to={`/traces/${s.trace_id}`}>{s.name}</Link>
                </td>
                <td style={{ textAlign: 'right' }}>{s.duration_ms} ms</td>
              </tr>
            ))}
            {stats.slowest.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">No spans yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
