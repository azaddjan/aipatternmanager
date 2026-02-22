const BASE_URL = '/api'

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...options.headers,
    },
    ...options,
  }
  const res = await fetch(url, config)
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Request failed: ${res.status}`)
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

export function createPattern(data) {
  return request('/patterns', { method: 'POST', body: JSON.stringify(data) })
}

export function updatePattern(id, data, versionBump = 'patch') {
  const qs = versionBump ? `?version_bump=${versionBump}` : ''
  return request(`/patterns/${id}${qs}`, { method: 'PUT', body: JSON.stringify(data) })
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

export function fetchFullGraph() {
  return request('/graph/full')
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

export function fetchProviders() {
  return request('/ai/providers')
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

// --- Export ---

export function exportHtmlUrl() {
  return `${BASE_URL}/admin/export/html`
}

export function exportPptxUrl() {
  return `${BASE_URL}/admin/export/pptx`
}

export function exportDocxUrl() {
  return `${BASE_URL}/admin/export/docx`
}

// --- Import ---

export async function importBackup(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/admin/import`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `Import failed: ${res.status}`)
  }
  return res.json()
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

// --- System ---

export function fetchHealth() {
  return request('/health')
}
