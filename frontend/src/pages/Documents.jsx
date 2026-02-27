import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listDocuments, deleteDocument, fetchTeams } from '../api/client'
import { useToast } from '../components/Toast'

const DOC_TYPE_LABELS = {
  guide: 'Guide',
  reference: 'Reference',
  adr: 'ADR',
  overview: 'Overview',
  other: 'Other',
}

const STATUS_COLORS = {
  draft: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  published: 'bg-green-500/10 text-green-400 border-green-500/30',
  archived: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const DOC_TYPE_COLORS = {
  guide: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  reference: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  adr: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  overview: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  other: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

export default function Documents() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [documents, setDocuments] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [docTypeFilter, setDocTypeFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [teams, setTeams] = useState([])
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    fetchTeams().then(res => setTeams(Array.isArray(res) ? res : res.teams || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (statusFilter) params.status = statusFilter
    if (docTypeFilter) params.doc_type = docTypeFilter
    if (teamFilter) params.team_id = teamFilter
    if (search.trim()) params.search = search.trim()

    listDocuments(params)
      .then(res => {
        setDocuments(res.documents || [])
        setTotal(res.total || 0)
      })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false))
  }, [statusFilter, docTypeFilter, teamFilter, search])

  const handleDelete = async (e, doc) => {
    e.stopPropagation()
    e.preventDefault()
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return
    setDeleting(doc.id)
    try {
      await deleteDocument(doc.id)
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
      setTotal(t => t - 1)
      toast.success(`Deleted ${doc.id}`)
    } catch (err) {
      toast.error(err.message)
    }
    setDeleting(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">{total} document{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate('/documents/new')}
          className="btn-primary"
        >
          + New Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search documents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-64"
        />
        <select
          value={docTypeFilter}
          onChange={e => setDocTypeFilter(e.target.value)}
          className="input"
        >
          <option value="">All Types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        {teams.length > 0 && (
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            className="input"
          >
            <option value="">All Teams</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Documents Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse">
              <div className="h-5 bg-gray-800 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-800 rounded w-full mb-2" />
              <div className="h-3 bg-gray-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📄</div>
          <h3 className="text-lg font-medium text-gray-300 mb-2">No documents yet</h3>
          <p className="text-gray-500 text-sm mb-6">Create your first document to start building your knowledge base.</p>
          <button onClick={() => navigate('/documents/new')} className="btn-primary">
            + New Document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map(doc => (
            <Link
              key={doc.id}
              to={`/documents/${doc.id}`}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 hover:bg-gray-900/80 transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-white font-medium text-sm truncate group-hover:text-blue-400 transition-colors">
                    {doc.title}
                  </h3>
                  <p className="text-[11px] font-mono text-gray-500 mt-0.5">{doc.id}</p>
                </div>
                <button
                  onClick={(e) => handleDelete(e, doc)}
                  disabled={deleting === doc.id}
                  className="ml-2 p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Summary */}
              {doc.summary && (
                <p className="text-gray-400 text-xs line-clamp-2 mb-3">{doc.summary}</p>
              )}

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${DOC_TYPE_COLORS[doc.doc_type] || DOC_TYPE_COLORS.other}`}>
                  {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[doc.status] || STATUS_COLORS.draft}`}>
                  {doc.status}
                </span>
                {doc.team_name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                    {doc.team_name}
                  </span>
                )}
              </div>

              {/* Footer stats */}
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span>{doc.section_count || 0} section{(doc.section_count || 0) !== 1 ? 's' : ''}</span>
                <span>&middot;</span>
                <span>{doc.link_count || 0} link{(doc.link_count || 0) !== 1 ? 's' : ''}</span>
                {doc.updated_date && (
                  <>
                    <span>&middot;</span>
                    <span>{new Date(doc.updated_date).toLocaleDateString()}</span>
                  </>
                )}
              </div>

              {/* Tags */}
              {doc.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {doc.tags.slice(0, 4).map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
                      {tag}
                    </span>
                  ))}
                  {doc.tags.length > 4 && (
                    <span className="text-[10px] text-gray-600">+{doc.tags.length - 4}</span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
