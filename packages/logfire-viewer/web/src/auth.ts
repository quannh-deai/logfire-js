const TOKEN_KEY = 'logfire-viewer.token'
const ADMIN_KEY = 'logfire-viewer.adminToken'

export interface AuthState {
  token: string | null
  adminToken: string | null
}

export function loadAuth(): AuthState {
  return {
    token: localStorage.getItem(TOKEN_KEY),
    adminToken: localStorage.getItem(ADMIN_KEY),
  }
}

export function setProjectToken(token: string | null): void {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY)
    return
  }
  localStorage.setItem(TOKEN_KEY, token)
}

export function setAdminToken(token: string | null): void {
  if (!token) {
    localStorage.removeItem(ADMIN_KEY)
    return
  }
  localStorage.setItem(ADMIN_KEY, token)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ADMIN_KEY)
}
