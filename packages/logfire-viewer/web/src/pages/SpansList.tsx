import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { ApiSpan } from '../api'
import { api, streamSpans } from '../api'
import { levelClass, levelLabel, LEVEL_OPTIONS } from '../lib/levels'

const TIME_PRESETS: { label: string; ms: number | null }[] = [
  { label: 'All time', ms: null },
  { label: 'Last 5 min', ms: 5 * 60_000 },
  { label: 'Last 15 min', ms: 15 * 60_000 },
  { label: 'Last 1 hr', ms: 60 * 60_000 },
  { label: 'Last 24 hr', ms: 24 * 60 * 60_000 },
]

export default function SpansList(): React.JSX.Element {
  const nav = useNavigate()
  const [service, setService] = useState('')
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const [windowMs, setWindowMs] = useState<number | null>(null)
  const [rows, setRows] = useState<ApiSpan[]>([])
  const [total, setTotal] = useState(0)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const from = useMemo(() => (windowMs ? Date.now() - windowMs : null), [windowMs, rows.length])

  async function refresh(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const r = await api.listSpans({
        service: service || undefined,
        level: level ? Number(level) : null,
        q: q || undefined,
        from,
        limit: 200,
      })
      setRows(r.rows)
      setTotal(r.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, level, q, windowMs])

  useEffect(() => {
    if (!live) return
    const close = streamSpans((batch) => {
      setRows((prev) => {
        const seen = new Set(prev.map((s) => s.span_id))
        const newRows = batch.filter((s) => !seen.has(s.span_id))
        return [...newRows, ...prev].slice(0, 500)
      })
    })
    return close
  }, [live])

  return (
    <div>
      <FilterBar
        service={service}
        setService={setService}
        level={level}
        setLevel={setLevel}
        q={q}
        setQ={setQ}
        windowMs={windowMs}
        setWindowMs={setWindowMs}
        live={live}
        setLive={setLive}
      />
      {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
      <div style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
        {loading ? 'Loading…' : `${rows.length} of ${total} spans`}
        {live && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>● LIVE</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 170 }}>Time</th>
            <th style={{ width: 80 }}>Level</th>
            <th style={{ width: 200 }}>Service</th>
            <th>Message</th>
            <th style={{ width: 80, textAlign: 'right' }}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={`${s.trace_id}:${s.span_id}`}
              className="row-clickable"
              onClick={() => nav(`/traces/${s.trace_id}`)}
            >
              <td>{new Date(s.start_time_ms).toLocaleString()}</td>
              <td>
                <span className={levelClass(s.logfire_level_num)}>
                  {levelLabel(s.logfire_level_num)}
                </span>
              </td>
              <td>{s.service_name ?? ''}</td>
              <td>{s.logfire_msg ?? s.name}</td>
              <td style={{ textAlign: 'right' }}>{s.duration_ms} ms</td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={5} className="empty">
                No spans match the current filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

interface FilterBarProps {
  service: string
  setService: (v: string) => void
  level: string
  setLevel: (v: string) => void
  q: string
  setQ: (v: string) => void
  windowMs: number | null
  setWindowMs: (v: number | null) => void
  live: boolean
  setLive: (v: boolean) => void
}

function FilterBar(p: FilterBarProps): React.JSX.Element {
  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="service"
        value={p.service}
        onChange={(e) => p.setService(e.target.value)}
      />
      <select value={p.level} onChange={(e) => p.setLevel(e.target.value)}>
        {LEVEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="search (FTS or substring)"
        value={p.q}
        onChange={(e) => p.setQ(e.target.value)}
      />
      <select
        value={String(p.windowMs ?? '')}
        onChange={(e) => p.setWindowMs(e.target.value ? Number(e.target.value) : null)}
      >
        {TIME_PRESETS.map((t) => (
          <option key={t.label} value={String(t.ms ?? '')}>
            {t.label}
          </option>
        ))}
      </select>
      <button
        className={`live-toggle ${p.live ? 'on' : ''}`}
        onClick={() => p.setLive(!p.live)}
      >
        {p.live ? '● Live' : '○ Live'}
      </button>
    </div>
  )
}
