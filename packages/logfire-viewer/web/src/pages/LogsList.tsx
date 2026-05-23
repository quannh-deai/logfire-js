import React from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { ApiLog } from '../api'
import { api, streamLogs } from '../api'
import { levelClass, levelLabel, LEVEL_OPTIONS } from '../lib/levels'

export default function LogsList(): React.JSX.Element {
  const nav = useNavigate()
  const [service, setService] = useState('')
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ApiLog[]>([])
  const [total, setTotal] = useState(0)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setError(null)
    try {
      const r = await api.listLogs({
        service: service || undefined,
        level: level ? Number(level) : null,
        q: q || undefined,
        limit: 200,
      })
      setRows(r.rows)
      setTotal(r.total)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, level, q])

  useEffect(() => {
    if (!live) return
    const close = streamLogs((batch) => {
      setRows((prev) => [...batch, ...prev].slice(0, 500))
    })
    return close
  }, [live])

  return (
    <div>
      <div className="filter-bar">
        <input
          type="text"
          placeholder="service"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="search (FTS or substring)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`live-toggle ${live ? 'on' : ''}`} onClick={() => setLive(!live)}>
          {live ? '● Live' : '○ Live'}
        </button>
      </div>
      {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
      <div style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
        {rows.length} of {total} logs
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 170 }}>Time</th>
            <th style={{ width: 80 }}>Level</th>
            <th style={{ width: 200 }}>Service</th>
            <th>Body</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr
              key={`${l.trace_id ?? 'no-trace'}-${i}-${l.time_ms}`}
              className={l.trace_id ? 'row-clickable' : ''}
              onClick={() => l.trace_id && nav(`/traces/${l.trace_id}`)}
            >
              <td>{new Date(l.time_ms).toLocaleString()}</td>
              <td>
                <span className={levelClass(l.logfire_level_num ?? l.severity_number)}>
                  {l.severity_text ?? levelLabel(l.logfire_level_num ?? l.severity_number)}
                </span>
              </td>
              <td>{l.service_name ?? ''}</td>
              <td style={{ fontFamily: 'ui-monospace, monospace' }}>{l.body ?? ''}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">No logs.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
