const BASE_URL = '/api'

function getStoredToken() {
  return localStorage.getItem('pm_access_token')
}

function getAuthHeaders() {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function attemptRefresh() {
  const refreshToken = localStorage.getItem('pm_refresh_token')
  if (!refreshToken) return false
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return false
    const data = await res.json()
    localStorage.setItem('pm_access_token', data.access_token)
    localStorage.setItem('pm_refresh_token', data.refresh_token)
    localStorage.setItem('pm_user', JSON.stringify(data.user))
    return true
  } catch {
    return false
  }
}

/**
 * Download a file from an authenticated endpoint using fetch + blob.
 * Handles token refresh automatically. Falls back to window.open on error.
 */
export async function authenticatedDownload(url, filename = null) {
  const headers = { ...getAuthHeaders() }

  let res = await fetch(url, { headers })

  // If 401, attempt token refresh once and retry
  if (res.status === 401 && getStoredToken()) {
    const refreshed = await attemptRefresh()
    if (refreshed) {
      res = await fetch(url, { headers: { ...getAuthHeaders() } })
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Download failed: ${res.status}`)
  }

  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl

  // Derive filename from Content-Disposition header or fallback
  if (!filename) {
    const disposition = res.headers.get('Content-Disposition')
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/)
      if (match) filename = match[1]
    }
  }
  if (!filename) filename = 'download'

  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...getAuthHeaders(),
      ...options.headers,
    },
    ...options,
  }
  let res = await fetch(url, config)

  // If 401, attempt token refresh once and retry
  if (res.status === 401 && getStoredToken()) {
    const refreshed = await attemptRefresh()
    if (refreshed) {
      config.headers = { ...config.headers, ...getAuthHeaders() }
      res = await fetch(url, config)
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    const err = new Error(error.detail || `Request failed: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// --- Patterns ---

export function fetchPatterns(params = {}) {
  const qs = new URLSearchParams()
  if (params.type) qs.set('type', params.type)
  if (params.category) qs.set('category', params.category)
  if (params.status) qs.set('status', params.status)
  if (params.skip != null) qs.set('skip', params.skip)
  if (params.limit != null) qs.set('limit', params.limit)
  const query = qs.toString()
  return request(`/patterns${query ? `?${query}` : ''}`)
}

export function fetchPattern(id) {
  return request(`/patterns/${id}`)
}

export function createPattern(data, teamId = null) {
  let url = '/patterns'
  if (teamId) url += `?team_id=${encodeURIComponent(teamId)}`
  return request(url, { method: 'POST', body: JSON.stringify(data) })
}

export function updatePattern(id, data, versionBump = 'patch', teamId = null) {
  let url = `/patterns/${encodeURIComponent(id)}?version_bump=${versionBump || 'patch'}`
  if (teamId !== null && teamId !== undefined) url += `&team_id=${encodeURIComponent(teamId)}`
  return request(url, { method: 'PUT', body: JSON.stringify(data) })
}

export function deletePattern(id) {
  return request(`/patterns/${id}`, { method: 'DELETE' })
}

export function fetchPatternGraph(id) {
  return request(`/patterns/${id}/graph`)
}

export function addRelationship(patternId, data) {
  return request(`/patterns/${patternId}/relationships`, { method: 'POST', body: JSON.stringify(data) })
}

export function removeRelationship(patternId, targetId, relType) {
  return request(`/patterns/${patternId}/relationships/${targetId}/${relType}`, { method: 'DELETE' })
}

export function generatePatternId(type, category) {
  return request(`/patterns/generate-id?type=${type}&category=${category}`)
}

// --- Technologies ---

export function fetchTechnologies(params = {}) {
  const qs = new URLSearchParams()
  if (params.vendor) qs.set('vendor', params.vendor)
  if (params.status) qs.set('status', params.status)
  if (params.category) qs.set('category', params.category)
  const query = qs.toString()
  return request(`/technologies${query ? `?${query}` : ''}`)
}

export function fetchTechnology(id) {
  return request(`/technologies/${encodeURIComponent(id)}`)
}

export function createTechnology(data) {
  return request('/technologies', { method: 'POST', body: JSON.stringify(data) })
}

export function updateTechnology(id, data) {
  return request(`/technologies/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteTechnology(id) {
  return request(`/technologies/${id}`, { method: 'DELETE' })
}

export function fetchTechnologyImpact(id) {
  return request(`/technologies/${id}/impact`)
}

export function fetchTechnologyGraph(id) {
  return request(`/technologies/${id}/graph`)
}

export function fetchTechnologyAlternatives(id) {
  return request(`/technologies/${id}/alternatives`)
}

export function fetchTechnologyAdoption(id) {
  return request(`/technologies/${id}/adoption`)
}

export function fetchTechnologyHealth(id) {
  return request(`/technologies/${id}/health`)
}

export function aiTechnologyAssist(data) {
  return request('/ai/technology-assist', { method: 'POST', body: JSON.stringify(data) })
}

// --- Categories ---

export function fetchCategories() {
  return request('/categories')
}

export function createCategory(data) {
  return request('/categories', { method: 'POST', body: JSON.stringify(data) })
}

export function fetchCategoryOverview(code) {
  return request(`/categories/${code}/overview`)
}

// --- PBCs (Business Capabilities) ---

export function fetchPBCs() {
  return request('/pbcs')
}

export function fetchPBC(id) {
  return request(`/pbcs/${id}`)
}

export function createPBC(data) {
  return request('/pbcs', { method: 'POST', body: JSON.stringify(data) })
}

export function updatePBC(id, data) {
  return request(`/pbcs/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deletePBC(id) {
  return request(`/pbcs/${id}`, { method: 'DELETE' })
}

export function fetchPBCGraph(id) {
  return request(`/pbcs/${id}/graph`)
}

// --- Graph ---

export function fetchFullGraph(teamId = null) {
  const params = teamId ? `?team_id=${encodeURIComponent(teamId)}` : ''
  return request(`/graph/full${params}`)
}

export function fetchImpactAnalysis(id) {
  return request(`/graph/impact/${id}`)
}

export function fetchCoverage() {
  return request('/graph/coverage')
}

// --- AI ---

export function aiGenerate(data) {
  return request('/ai/generate', { method: 'POST', body: JSON.stringify(data) })
}

export function aiAnalyzeContext(data) {
  return request('/ai/analyze-context', { method: 'POST', body: JSON.stringify(data) })
}

export function fetchProviders() {
  return request('/ai/providers')
}

export function aiFieldAssist(data) {
  return request('/ai/field-assist', { method: 'POST', body: JSON.stringify(data) })
}

export function aiSmartAction(data) {
  return request('/ai/smart-actions', { method: 'POST', body: JSON.stringify(data) })
}

export function aiTechnologySuggest(data) {
  return request('/ai/technology-suggest', { method: 'POST', body: JSON.stringify(data) })
}

export function aiPatternAssist(data) {
  return request('/ai/pattern-assist', { method: 'POST', body: JSON.stringify(data) })
}

export function aiPBCAssist(data) {
  return request('/ai/pbc-assist', { method: 'POST', body: JSON.stringify(data) })
}

// --- Admin ---

export function fetchAdminSettings() {
  return request('/admin/settings')
}

export function updateAdminSettings(data) {
  return request('/admin/settings', { method: 'PUT', body: JSON.stringify(data) })
}

export function setApiKey(provider, key, secret = null) {
  return request('/admin/api-key', {
    method: 'POST',
    body: JSON.stringify({ provider, key, secret }),
  })
}

export function testProvider(providerName) {
  return request(`/admin/test-provider/${providerName}`, { method: 'POST' })
}

// --- Export ---

export function exportHtmlUrl(teamIds = null) {
  const params = teamIds?.length ? `?team_ids=${teamIds.join(',')}` : ''
  return `${BASE_URL}/admin/export/html${params}`
}

export function exportPptxUrl(teamIds = null) {
  const params = teamIds?.length ? `?team_ids=${teamIds.join(',')}` : ''
  return `${BASE_URL}/admin/export/pptx${params}`
}

export function exportDocxUrl(teamIds = null) {
  const params = teamIds?.length ? `?team_ids=${teamIds.join(',')}` : ''
  return `${BASE_URL}/admin/export/docx${params}`
}

export function exportJsonUrl() {
  return `${BASE_URL}/admin/export/json`
}

// --- Import ---

export async function importPreview(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/admin/import/preview`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Preview failed: ${res.status}`)
  }
  return res.json()
}

export async function importBackup(file, include = null) {
  const formData = new FormData()
  formData.append('file', file)
  let url = `${BASE_URL}/admin/import`
  if (include && include.length > 0) {
    url += `?include=${include.join(',')}`
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Import failed: ${res.status}`)
  }
  return res.json()
}

// --- Backups ---

export function createBackup(name = '') {
  return request('/admin/backups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function fetchBackups() {
  return request('/admin/backups')
}

export function downloadBackupUrl(filename) {
  return `${BASE_URL}/admin/backups/${encodeURIComponent(filename)}`
}

export function deleteBackup(filename) {
  return request(`/admin/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}

export function restoreBackup(filename) {
  return request(`/admin/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' })
}

// --- System Status ---

export function fetchSystemStatus() {
  return request('/admin/system-status')
}

export function embedMissingNodes() {
  return request('/admin/embed-missing', { method: 'POST' })
}

export function embedAllNodes() {
  return request('/admin/embed-all', { method: 'POST' })
}

// --- Advisor (GraphRAG) ---

export function analyzePattern(data) {
  return request('/advisor/analyze', { method: 'POST', body: JSON.stringify(data) })
}

export function clarifyProblem(data) {
  return request('/advisor/clarify', { method: 'POST', body: JSON.stringify(data) })
}

export function generateEmbeddings() {
  return request('/advisor/embed', { method: 'POST' })
}

export function fetchEmbeddingStatus() {
  return request('/advisor/embed/status')
}

// --- Advisor Reports ---

export function fetchAdvisorReports(limit = 50) {
  return request(`/advisor/reports?limit=${limit}`)
}

export function fetchAdvisorReport(id) {
  return request(`/advisor/reports/${encodeURIComponent(id)}`)
}

export function updateAdvisorReport(id, data) {
  return request(`/advisor/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteAdvisorReport(id) {
  return request(`/advisor/reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function deleteAllAdvisorReports() {
  return request('/advisor/reports?confirm=true', { method: 'DELETE' })
}

export function cleanupAdvisorReports() {
  return request('/advisor/reports/cleanup', { method: 'POST' })
}

export function advisorReportExportHtmlUrl(id) {
  return `${BASE_URL}/advisor/reports/${encodeURIComponent(id)}/export/html`
}

export function advisorReportExportDocxUrl(id) {
  return `${BASE_URL}/advisor/reports/${encodeURIComponent(id)}/export/docx`
}

// --- Pattern Health ---

export function fetchPatternHealth(teamId = null) {
  const params = teamId ? `?team_id=${encodeURIComponent(teamId)}` : ''
  return request(`/pattern-health${params}`)
}

export function analyzePatternHealth(provider = null, model = null, teamId = null) {
  const body = {}
  if (provider) body.provider = provider
  if (model) body.model = model
  if (teamId) body.team_id = teamId
  return request('/pattern-health/analyze', { method: 'POST', body: JSON.stringify(body) })
}

// --- Health Analysis Persistence ---

export function fetchLatestHealthAnalysis() {
  return request('/pattern-health/analyses/latest')
}

export function fetchHealthAnalyses(limit = 20) {
  return request(`/pattern-health/analyses?limit=${limit}`)
}

export function fetchHealthAnalysis(id) {
  return request(`/pattern-health/analyses/${encodeURIComponent(id)}`)
}

export function deleteHealthAnalysis(id) {
  return request(`/pattern-health/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function healthAnalysisExportHtmlUrl(id) {
  return `${BASE_URL}/pattern-health/analyses/${encodeURIComponent(id)}/export/html`
}

export function healthAnalysisExportDocxUrl(id) {
  return `${BASE_URL}/pattern-health/analyses/${encodeURIComponent(id)}/export/docx`
}

// --- Discovery ---

export function fetchInventory() {
  return request('/discovery/inventory')
}

export function discoverPatterns(provider = null, model = null, focus = null) {
  const qs = new URLSearchParams()
  if (provider) qs.set('provider', provider)
  if (model) qs.set('model', model)
  if (focus) qs.set('focus', focus)
  const query = qs.toString()
  return request(`/discovery/suggest${query ? `?${query}` : ''}`, { method: 'POST' })
}

// --- Pattern Images ---

export async function uploadPatternImage(patternId, file, title = '') {
  const formData = new FormData()
  formData.append('file', file)
  const url = `${BASE_URL}/patterns/${patternId}/images?title=${encodeURIComponent(title)}`
  const res = await fetch(url, { method: 'POST', headers: { ...getAuthHeaders() }, body: formData })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Upload failed: ${res.status}`)
  }
  return res.json()
}

export function deletePatternImage(patternId, imageId) {
  return request(`/patterns/${patternId}/images/${imageId}`, { method: 'DELETE' })
}

export function getArtifactsUrl(patternId) {
  return `${BASE_URL}/patterns/${patternId}/artifacts`
}

export function getUploadUrl(filename) {
  return `${BASE_URL}/uploads/${filename}`
}

// --- Users (Admin) ---

export async function fetchUsers() {
  const res = await request('/users')
  return res.users || res
}

export function fetchUser(id) {
  return request(`/users/${encodeURIComponent(id)}`)
}

export function createUser(data) {
  return request('/users', { method: 'POST', body: JSON.stringify(data) })
}

export function updateUser(id, data) {
  return request(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteUser(id) {
  return request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- Teams (Admin) ---

export async function fetchTeams() {
  const res = await request('/teams')
  return res.teams || res
}

export function fetchTeam(id) {
  return request(`/teams/${encodeURIComponent(id)}`)
}

export function createTeam(data) {
  return request('/teams', { method: 'POST', body: JSON.stringify(data) })
}

export function updateTeam(id, data) {
  return request(`/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteTeam(id) {
  return request(`/teams/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function assignPatternsToTeam(teamId, patternIds) {
  return request('/teams/assign-patterns', {
    method: 'POST',
    body: JSON.stringify({ team_id: teamId, pattern_ids: patternIds }),
  })
}

// --- AI Prompts (Admin) ---

export function fetchPrompts() {
  return request('/admin/prompts')
}

export function updatePrompt(section, subPrompt, value) {
  return request(`/admin/prompts/${encodeURIComponent(section)}/${encodeURIComponent(subPrompt)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}

export function resetPrompt(section, subPrompt) {
  return request(`/admin/prompts/${encodeURIComponent(section)}/${encodeURIComponent(subPrompt)}`, {
    method: 'DELETE',
  })
}

export function testPrompt(systemPrompt, userPrompt, provider = null, model = null) {
  const body = { system_prompt: systemPrompt, user_prompt: userPrompt }
  if (provider) body.provider = provider
  if (model) body.model = model
  return request('/admin/prompts/test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// --- System ---

export function fetchHealth() {
  return request('/health')
}
