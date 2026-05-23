import React from 'react'
import { useEffect, useState } from 'react'

import { api } from '../api'

const STORAGE_KEY = 'logfire-viewer.lastQuery'
const DEFAULT_QUERY =
  'SELECT trace_id, name, service_name, logfire_level_num, duration_ns FROM spans ORDER BY start_time_ns DESC LIMIT 50'

export default function SqlEditor(): React.JSX.Element {
  const [sql, setSql] = useState(localStorage.getItem(STORAGE_KEY) ?? DEFAULT_QUERY)
  const [result, setResult] = useState<{ columns: string[]; rows: unknown[][]; truncated?: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sql)
  }, [sql])

  async function run(): Promise<void> {
    setRunning(true)
    setError(null)
    try {
      const r = await api.query(sql)
      setResult(r)
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <textarea
        className="sql-editor"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run (Ctrl+Enter)'}
        </button>
        <span style={{ color: 'var(--fg-dim)', alignSelf: 'center' }}>
          Read-only: SELECT, WITH, EXPLAIN, PRAGMA only.
        </span>
      </div>
      {error && <div className="banner" style={{ color: 'var(--red)' }}>{error}</div>}
      {result && (
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <div style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
            {result.rows.length} rows{result.truncated ? ' (truncated)' : ''}
          </div>
          <table>
            <thead>
              <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {cell == null ? <span style={{ color: 'var(--fg-dim)' }}>null</span> : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
