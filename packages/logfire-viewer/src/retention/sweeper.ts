import type Database from 'better-sqlite3'

import type { ProjectRegistry } from '../tenancy/registry.js'
import type { Project } from '../types.js'

export interface SweepStats {
  projectId: string
  spansDeleted: number
  logsDeleted: number
  metricPointsDeleted: number
  streamsDeleted: number
}

export function sweepProject(db: Database.Database, project: Project): SweepStats {
  const nowNs = BigInt(Date.now()) * 1_000_000n
  let spansDeleted = 0
  let logsDeleted = 0
  let metricPointsDeleted = 0
  let streamsDeleted = 0

  if (project.retention_days > 0) {
    const cutoff = nowNs - BigInt(project.retention_days) * 86_400_000_000_000n
    spansDeleted += db.prepare('DELETE FROM spans WHERE start_time_ns < ?').run(cutoff).changes
    logsDeleted += db.prepare('DELETE FROM logs WHERE time_unix_ns < ?').run(cutoff).changes
    metricPointsDeleted += db
      .prepare('DELETE FROM metric_points WHERE time_unix_ns < ?')
      .run(cutoff).changes
  }
  if (project.retention_max_rows > 0) {
    spansDeleted += db
      .prepare(
        `DELETE FROM spans WHERE rowid IN (
           SELECT rowid FROM spans ORDER BY start_time_ns ASC
           LIMIT MAX(0, (SELECT COUNT(*) FROM spans) - ?)
         )`,
      )
      .run(project.retention_max_rows).changes
    logsDeleted += db
      .prepare(
        `DELETE FROM logs WHERE id IN (
           SELECT id FROM logs ORDER BY time_unix_ns ASC
           LIMIT MAX(0, (SELECT COUNT(*) FROM logs) - ?)
         )`,
      )
      .run(project.retention_max_rows).changes
    metricPointsDeleted += db
      .prepare(
        `DELETE FROM metric_points WHERE rowid IN (
           SELECT rowid FROM metric_points ORDER BY time_unix_ns ASC
           LIMIT MAX(0, (SELECT COUNT(*) FROM metric_points) - ?)
         )`,
      )
      .run(project.retention_max_rows).changes
  }
  // Drop streams whose points are all gone.
  streamsDeleted = db
    .prepare(
      `DELETE FROM metric_streams WHERE stream_id NOT IN (
         SELECT DISTINCT stream_id FROM metric_points
       )`,
    )
    .run().changes
  // Best-effort reclaim disk.
  try {
    db.prepare('PRAGMA incremental_vacuum').run()
  } catch {
    // ignore
  }
  return {
    projectId: project.id,
    spansDeleted,
    logsDeleted,
    metricPointsDeleted,
    streamsDeleted,
  }
}

export interface RetentionLoop {
  stop(): void
}

export function startRetentionLoop(
  registry: ProjectRegistry,
  intervalMs: number,
  onStats?: (stats: SweepStats) => void,
): RetentionLoop {
  const handle = setInterval(() => {
    for (const { project, db } of registry.openDatabases()) {
      if (project.retention_days <= 0 && project.retention_max_rows <= 0) continue
      try {
        const stats = sweepProject(db.rw, project)
        onStats?.(stats)
      } catch {
        // best-effort
      }
    }
  }, intervalMs)
  handle.unref?.()
  return {
    stop() {
      clearInterval(handle)
    },
  }
}
