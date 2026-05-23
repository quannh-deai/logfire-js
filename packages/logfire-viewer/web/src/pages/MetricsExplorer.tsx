import React from 'react'
import { useEffect, useState } from 'react'

import type { MetricSeries, MetricStream } from '../api'
import { api } from '../api'

function SparkLine({ points }: { points: { t: number; v: number | null }[] }): React.JSX.Element {
  if (points.length === 0) return <div className="empty">No points.</div>
  const xs = points.map((p) => p.t)
  const ys = points.map((p) => p.v ?? 0)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const W = 720
  const H = 220
  const pad = 24
  const xToPx = (x: number): number =>
    pad + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - pad * 2)
  const yToPx = (y: number): number =>
    H - pad - ((y - yMin) / Math.max(1, yMax - yMin)) * (H - pad * 2)
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.t).toFixed(1)} ${yToPx(p.v ?? 0).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={W} height={H} style={{ background: 'var(--bg-elev)', borderRadius: 6 }}>
      <path d={path} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
      <text x={pad} y={H - 6} fill="var(--fg-dim)" fontSize={11}>
        {new Date(xMin).toLocaleTimeString()}
      </text>
      <text x={W - pad - 80} y={H - 6} fill="var(--fg-dim)" fontSize={11}>
        {new Date(xMax).toLocaleTimeString()}
      </text>
      <text x={pad} y={pad} fill="var(--fg-dim)" fontSize={11}>
        {yMax.toFixed(2)}
      </text>
      <text x={pad} y={H - pad} fill="var(--fg-dim)" fontSize={11}>
        {yMin.toFixed(2)}
      </text>
    </svg>
  )
}

export default function MetricsExplorer(): React.JSX.Element {
  const [streams, setStreams] = useState<MetricStream[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [series, setSeries] = useState<MetricSeries | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listMetricStreams({ name: filter || undefined })
      .then((r) => setStreams(r.streams))
      .catch((e: Error) => setError(e.message))
  }, [filter])

  useEffect(() => {
    if (!selected) {
      setSeries(null)
      return
    }
    api
      .getMetricSeries(selected)
      .then(setSeries)
      .catch((e: Error) => setError(e.message))
  }, [selected])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div>
        <input
          type="text"
          placeholder="filter metric name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <div style={{ maxHeight: 'calc(100vh - 160px)', overflow: 'auto' }}>
          {streams.map((s) => (
            <div
              key={s.stream_id}
              onClick={() => setSelected(s.stream_id)}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                background: selected === s.stream_id ? 'var(--accent-dim)' : undefined,
                borderRadius: 4,
              }}
            >
              <div>{s.metric_name}</div>
              <div style={{ color: 'var(--fg-dim)', fontSize: 12 }}>
                {s.kind} {s.unit ? `· ${s.unit}` : ''} · {s.service_name ?? ''}
              </div>
            </div>
          ))}
          {streams.length === 0 && <div className="empty">No metrics.</div>}
        </div>
      </div>
      <div>
        {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
        {series ? (
          <>
            <h2 style={{ marginTop: 0 }}>
              {series.metric_name} <span style={{ color: 'var(--fg-dim)' }}>({series.kind})</span>
            </h2>
            <SparkLine points={series.points} />
          </>
        ) : (
          <div className="empty">Select a metric.</div>
        )}
      </div>
    </div>
  )
}
