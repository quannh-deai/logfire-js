import React from 'react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { ApiSpan, TraceResponse } from '../api'
import { api } from '../api'
import { levelClass, levelLabel } from '../lib/levels'

interface TreeNode {
  span: ApiSpan
  children: TreeNode[]
}

function buildTree(spans: ApiSpan[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  spans.forEach((s) => byId.set(s.span_id, { span: s, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    const parent = node.span.parent_span_id && byId.get(node.span.parent_span_id)
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  byId.forEach((node) => node.children.sort((a, b) => a.span.start_time_ms - b.span.start_time_ms))
  return roots
}

export default function TraceView(): React.JSX.Element {
  const { traceId = '' } = useParams()
  const [trace, setTrace] = useState<TraceResponse | null>(null)
  const [selected, setSelected] = useState<ApiSpan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getTrace(traceId)
      .then((t) => {
        setTrace(t)
        setSelected(t.spans[0] ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [traceId])

  if (error) return <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>
  if (!trace) return <div>Loading…</div>

  const tStart = Math.min(...trace.spans.map((s) => s.start_time_ms))
  const tEnd = Math.max(...trace.spans.map((s) => s.end_time_ms))
  const totalMs = Math.max(1, tEnd - tStart)
  const tree = buildTree(trace.spans)

  function renderNode(node: TreeNode, depth: number): React.JSX.Element[] {
    const s = node.span
    const left = ((s.start_time_ms - tStart) / totalMs) * 100
    const width = Math.max(0.5, (s.duration_ms / totalMs) * 100)
    const isError = s.status_code === 2 || (s.logfire_level_num ?? 0) >= 17
    const isWarn = (s.logfire_level_num ?? 0) >= 13 && (s.logfire_level_num ?? 0) < 17
    const barCls = isError ? 'waterfall-bar error' : isWarn ? 'waterfall-bar warning' : 'waterfall-bar'
    return [
      <div
        key={s.span_id}
        className="waterfall-row"
        onClick={() => setSelected(s)}
        style={{ background: selected?.span_id === s.span_id ? 'var(--accent-dim)' : undefined }}
      >
        <span style={{ paddingLeft: depth * 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.logfire_msg ?? s.name}
        </span>
        <div className="waterfall-track">
          <div className={barCls} style={{ left: `${left}%`, width: `${width}%` }} />
        </div>
      </div>,
      ...node.children.flatMap((c) => renderNode(c, depth + 1)),
    ]
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Trace {traceId.slice(0, 16)}…</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div>
          <div style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
            {trace.spans.length} spans, {totalMs.toFixed(0)} ms total
          </div>
          <div className="waterfall">{tree.flatMap((r) => renderNode(r, 0))}</div>
        </div>
        <div>
          {selected ? (
            <div>
              <h3 style={{ marginTop: 0 }}>
                <span className={levelClass(selected.logfire_level_num)}>
                  {levelLabel(selected.logfire_level_num) || 'span'}
                </span>{' '}
                {selected.logfire_msg ?? selected.name}
              </h3>
              <div className="kvs">
                <span className="k">trace_id</span>
                <span className="v">{selected.trace_id}</span>
                <span className="k">span_id</span>
                <span className="v">{selected.span_id}</span>
                <span className="k">parent</span>
                <span className="v">{selected.parent_span_id ?? '(root)'}</span>
                <span className="k">service</span>
                <span className="v">{selected.service_name ?? ''}</span>
                <span className="k">duration</span>
                <span className="v">{selected.duration_ms} ms</span>
                <span className="k">status</span>
                <span className="v">
                  {selected.status_code} {selected.status_message ?? ''}
                </span>
              </div>
              <h4>Attributes</h4>
              <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(selected.attributes, null, 2)}
              </pre>
              {selected.events && selected.events.length > 0 && (
                <>
                  <h4>Events</h4>
                  <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(selected.events, null, 2)}
                  </pre>
                </>
              )}
            </div>
          ) : (
            <div className="empty">Select a span</div>
          )}
        </div>
      </div>
    </div>
  )
}
