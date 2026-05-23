import React from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { clearAuth, loadAuth } from './auth'
import Admin from './pages/Admin'
import Dashboard from './pages/Dashboard'
import LogsList from './pages/LogsList'
import Login from './pages/Login'
import MetricsExplorer from './pages/MetricsExplorer'
import SpansList from './pages/SpansList'
import SqlEditor from './pages/SqlEditor'
import TraceView from './pages/TraceView'

function Header({ adminMode }: { adminMode: boolean }): React.JSX.Element {
  const nav = useNavigate()
  return (
    <header className="header">
      <span className="logo">⚡ logfire-viewer</span>
      <nav>
        {!adminMode && (
          <>
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Spans
            </NavLink>
            <NavLink to="/logs" className={({ isActive }) => (isActive ? 'active' : '')}>
              Logs
            </NavLink>
            <NavLink to="/metrics" className={({ isActive }) => (isActive ? 'active' : '')}>
              Metrics
            </NavLink>
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
              Dashboard
            </NavLink>
            <NavLink to="/sql" className={({ isActive }) => (isActive ? 'active' : '')}>
              SQL
            </NavLink>
          </>
        )}
        {adminMode && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
            Admin
          </NavLink>
        )}
      </nav>
      <span className="flex-spacer" />
      <button
        onClick={() => {
          clearAuth()
          nav('/login', { replace: true })
        }}
      >
        Log out
      </button>
    </header>
  )
}

export default function App(): React.JSX.Element {
  const { token, adminToken } = loadAuth()
  const loc = useLocation()
  if (!token && !adminToken && loc.pathname !== '/login') {
    return <Navigate to="/login" replace />
  }
  if (loc.pathname === '/login') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  const adminMode = !!adminToken && !token
  return (
    <div className="layout">
      <Header adminMode={adminMode} />
      <div className="main">
        <Routes>
          {adminMode ? (
            <>
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<SpansList />} />
              <Route path="/traces/:traceId" element={<TraceView />} />
              <Route path="/logs" element={<LogsList />} />
              <Route path="/metrics" element={<MetricsExplorer />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/sql" element={<SqlEditor />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </div>
    </div>
  )
}
