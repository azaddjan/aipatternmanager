import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

const TOKEN_KEY = 'pm_access_token'
const REFRESH_KEY = 'pm_refresh_token'
const USER_KEY = 'pm_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem(USER_KEY)
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  // On mount, validate the stored token
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!res.ok) throw new Error('Invalid token')
        return res.json()
      })
      .then(userData => {
        setUser(userData)
        localStorage.setItem(USER_KEY, JSON.stringify(userData))
      })
      .catch(() => {
        // Try refresh
        const rt = localStorage.getItem(REFRESH_KEY)
        if (!rt) {
          logout()
          return
        }
        fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        })
          .then(res => {
            if (!res.ok) throw new Error('Refresh failed')
            return res.json()
          })
          .then(data => {
            localStorage.setItem(TOKEN_KEY, data.access_token)
            localStorage.setItem(REFRESH_KEY, data.refresh_token)
            localStorage.setItem(USER_KEY, JSON.stringify(data.user))
            setUser(data.user)
          })
          .catch(() => logout())
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }, [])

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), [])

  const isAdmin = user?.role === 'admin'
  const isTeamMember = user?.role === 'team_member'
  const isViewer = user?.role === 'viewer'
  const isAuthenticated = !!user

  const canEditPattern = useCallback((pattern) => {
    if (!user) return false
    if (isAdmin) return true
    if (isViewer) return false
    // team_member — check if pattern is owned by user's team
    return pattern?.team_id === user.team_id
  }, [user, isAdmin, isViewer])

  const canCreatePattern = isAdmin || isTeamMember

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, getToken,
      isAdmin, isTeamMember, isViewer, isAuthenticated,
      canEditPattern, canCreatePattern,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { TOKEN_KEY, REFRESH_KEY }
