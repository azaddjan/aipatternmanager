import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  getDocument, createDocument, updateDocument, deleteDocument,
  addDocumentSection, updateDocumentSection, deleteDocumentSection,
  reorderDocumentSections, linkDocumentEntity, unlinkDocumentEntity,
  fetchTeams, fetchPatterns, fetchTechnologies, fetchPBCs,
  aiDocumentSectionAssist,
} from '../api/client'
import { useToast } from '../components/Toast'
import MarkdownContent from '../components/MarkdownContent'
import AIDocumentDrafter from '../components/AIDocumentDrafter'

const DOC_TYPES = ['guide', 'reference', 'adr', 'overview', 'other']
const STATUSES = ['draft', 'published', 'archived']

// ── Mermaid diagram templates ──
const DIAGRAM_TEMPLATES = {
  flowchart: `\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
\`\`\``,
  sequence: `\`\`\`mermaid
sequenceDiagram
    participant Client
    participant API
    participant Service
    participant Database
    Client->>API: Request
    API->>Service: Process
    Service->>Database: Query
    Database-->>Service: Result
    Service-->>API: Response
    API-->>Client: Response
\`\`\``,
  classDiagram: `\`\`\`mermaid
classDiagram
    class Component {
        +String name
        +String type
        +execute()
    }
    class Service {
        +process()
        +validate()
    }
    Component --> Service : uses
\`\`\``,
  stateDiagram: `\`\`\`mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review : Submit
    Review --> Published : Approve
    Review --> Draft : Reject
    Published --> Archived : Archive
    Archived --> [*]
\`\`\``,
  erDiagram: `\`\`\`mermaid
erDiagram
    ENTITY ||--o{ ATTRIBUTE : has
    ENTITY ||--|{ RELATIONSHIP : participates
    ENTITY {
        string id PK
        string name
        string type
    }
\`\`\``,
  gantt: `\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
        Task 1 :a1, 2025-01-01, 30d
        Task 2 :after a1, 20d
    section Phase 2
        Task 3 :2025-02-20, 25d
        Task 4 :2025-03-15, 15d
\`\`\``,
}

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()

  const isNew = id === 'new'
  const fromAnalysis = searchParams.get('from_analysis')

  // Document state
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  // Editable metadata
  const [title, setTitle] = useState('Untitled Document')
  const [docType, setDocType] = useState('guide')
  const [status, setStatus] = useState('draft')
  const [summary, setSummary] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [teamId, setTeamId] = useState('')

  // Sections
  const [sections, setSections] = useState([])
  const [editingSectionId, setEditingSectionId] = useState(null)

  // Linked entities
  const [linkedEntities, setLinkedEntities] = useState([])
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [linkSearching, setLinkSearching] = useState(false)

  // UI
  const [activeTab, setActiveTab] = useState('sections')
  const [teams, setTeams] = useState([])
  const [editMode, setEditMode] = useState(isNew)

  useEffect(() => {
    fetchTeams().then(res => setTeams(Array.isArray(res) ? res : res.teams || [])).catch(() => {})
  }, [])

  // Load existing document
  useEffect(() => {
    if (isNew) {
      if (fromAnalysis) {
        setTitle(`Supporting: Analysis ${fromAnalysis}`)
      }
      return
    }
    setLoading(true)
    getDocument(id)
      .then(d => {
        setDoc(d)
        setTitle(d.title || '')
        setDocType(d.doc_type || 'guide')
        setStatus(d.status || 'draft')
        setSummary(d.summary || '')
        setTagsInput((d.tags || []).join(', '))
        setTeamId(d.team_id || '')
        setSections(d.sections || [])
        setLinkedEntities(d.linked_entities || [])
      })
      .catch(err => {
        toast.error(err.message)
        navigate('/documents')
      })
      .finally(() => setLoading(false))
  }, [id, isNew])

  // Save document (create or update)
  const handleApplyDraft = (draft) => {
    setTitle(draft.title || 'Untitled Document')
    if (draft.doc_type) setDocType(draft.doc_type)
    if (draft.summary !== undefined) setSummary(draft.summary)
    if (draft.tags !== undefined) setTagsInput(typeof draft.tags === 'string' ? draft.tags : '')
    if (draft.sections) setSections(draft.sections)
  }

  const handleSave = async () => {
    setSaving(true)
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
    try {
      if (isNew) {
        const data = {
          title, doc_type: docType, status, summary, tags,
          team_id: teamId || undefined,
          source_analysis_id: fromAnalysis || undefined,
          sections: sections.map((s, i) => ({ title: s.title, content: s.content || '', order_index: i })),
        }
        const created = await createDocument(data)
        toast.success(`Created ${created.id}`)
        navigate(`/documents/${created.id}`, { replace: true })
      } else {
        await updateDocument(id, { title, doc_type: docType, status, summary, tags, team_id: teamId || null })
        toast.success('Document updated')
        setEditMode(false)
        // Refresh
        const updated = await getDocument(id)
        setDoc(updated)
      }
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${title}"? This will delete all sections too.`)) return
    try {
      await deleteDocument(id)
      toast.success('Document deleted')
      navigate('/documents')
    } catch (err) {
      toast.error(err.message)
    }
  }

  // Section operations
  const handleAddSection = async () => {
    if (isNew) {
      // For new documents, just add to local state
      setSections(prev => [...prev, { id: `new-${Date.now()}`, title: 'New Section', content: '', order_index: prev.length }])
      return
    }
    try {
      const section = await addDocumentSection(id, { title: 'New Section', content: '' })
      setSections(prev => [...prev, section])
      setEditingSectionId(section.id)
      toast.success('Section added')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleSaveSection = async (sectionId, data) => {
    if (isNew || sectionId.startsWith('new-')) {
      // Local update for new doc
      setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...data } : s))
      setEditingSectionId(null)
      return
    }
    try {
      const updated = await updateDocumentSection(id, sectionId, data)
      setSections(prev => prev.map(s => s.id === sectionId ? updated : s))
      setEditingSectionId(null)
      toast.success('Section saved')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteSection = async (sectionId) => {
    if (!confirm('Delete this section?')) return
    if (isNew || sectionId.startsWith('new-')) {
      setSections(prev => prev.filter(s => s.id !== sectionId))
      return
    }
    try {
      await deleteDocumentSection(id, sectionId)
      setSections(prev => prev.filter(s => s.id !== sectionId))
      toast.success('Section deleted')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleMoveSection = async (index, direction) => {
    const newSections = [...sections]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newSections.length) return
    ;[newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]]
    setSections(newSections)
    if (!isNew) {
      try {
        await reorderDocumentSections(id, newSections.map(s => s.id))
      } catch (err) {
        toast.error(err.message)
      }
    }
  }

  // Link entity
  const handleSearchEntities = async () => {
    if (!linkSearch.trim()) return
    setLinkSearching(true)
    try {
      const [patterns, techs, pbcs] = await Promise.all([
        fetchPatterns({ limit: 500 }),
        fetchTechnologies(),
        fetchPBCs(),
      ])
      const q = linkSearch.toLowerCase()
      const results = []

      for (const p of (patterns.patterns || [])) {
        if (p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q)) {
          results.push({ id: p.id, name: p.name, label: 'Pattern' })
        }
      }
      for (const t of (techs.technologies || [])) {
        if (t.name?.toLowerCase().includes(q) || t.id?.toLowerCase().includes(q)) {
          results.push({ id: t.id, name: t.name, label: 'Technology' })
        }
      }
      for (const pbc of (pbcs.pbcs || pbcs || [])) {
        if (pbc.name?.toLowerCase().includes(q) || pbc.id?.toLowerCase().includes(q)) {
          results.push({ id: pbc.id, name: pbc.name, label: 'PBC' })
        }
      }

      // Filter out already linked
      const linkedIds = new Set(linkedEntities.map(e => e.id))
      setLinkResults(results.filter(r => !linkedIds.has(r.id)).slice(0, 10))
    } catch (err) {
      toast.error(err.message)
    }
    setLinkSearching(false)
  }

  const handleLinkEntity = async (entity) => {
    if (isNew) {
      toast.error('Save the document first before linking entities')
      return
    }
    try {
      await linkDocumentEntity(id, entity.id, entity.label)
      setLinkedEntities(prev => [...prev, entity])
      setLinkResults(prev => prev.filter(r => r.id !== entity.id))
      toast.success(`Linked ${entity.id}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleUnlinkEntity = async (entityId) => {
    try {
      await unlinkDocumentEntity(id, entityId)
      setLinkedEntities(prev => prev.filter(e => e.id !== entityId))
      toast.success('Unlinked')
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-1/3" />
        <div className="h-4 bg-gray-800 rounded w-1/4" />
        <div className="h-64 bg-gray-800 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Back link */}
      <button onClick={() => navigate('/documents')} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
        &larr; Back to Documents
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editMode ? (
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-2xl font-bold text-white bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none w-full pb-1"
              placeholder="Document title..."
            />
          ) : (
            <h1 className="text-2xl font-bold text-white">{title}</h1>
          )}
          {!isNew && (
            <p className="text-xs text-gray-500 font-mono mt-1">{id}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isNew && !editMode && (
            <>
              <button onClick={() => setEditMode(true)} className="btn-secondary text-sm">
                Edit
              </button>
              <button onClick={handleDelete} className="text-sm px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                Delete
              </button>
            </>
          )}
          {editMode && (
            <>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                {saving ? 'Saving...' : isNew ? 'Create Document' : 'Save'}
              </button>
              {!isNew && (
                <button onClick={() => setEditMode(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* AI Document Assistant */}
      {editMode && (
        <AIDocumentDrafter
          isNew={isNew}
          title={title}
          docType={docType}
          summary={summary}
          tags={tagsInput}
          sections={sections}
          onApplyDraft={handleApplyDraft}
        />
      )}

      {/* Metadata */}
      {editMode ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)} className="input w-full">
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Team</label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)} className="input w-full">
                <option value="">No Team</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className="input w-full">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tags (comma-separated)</label>
              <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} className="input w-full" placeholder="tag1, tag2" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              className="input w-full"
              rows={2}
              placeholder="Brief description of this document..."
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] px-2 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/30">
            {docType}
          </span>
          <span className={`text-[11px] px-2 py-0.5 rounded border ${
            status === 'published' ? 'bg-green-500/10 text-green-400 border-green-500/30'
            : status === 'archived' ? 'bg-gray-500/10 text-gray-400 border-gray-500/30'
            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
          }`}>
            {status}
          </span>
          {doc?.team_name && (
            <span className="text-[11px] px-2 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
              {doc.team_name}
            </span>
          )}
          {doc?.tags?.map(t => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{t}</span>
          ))}
          {summary && <p className="text-sm text-gray-400 w-full mt-1">{summary}</p>}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {['sections', 'linked'].map(tab => (
          <button
            key={tab}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'sections' ? `Sections (${sections.length})` : `Linked Entities (${linkedEntities.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'sections' && (
        <div className="space-y-4">
          {sections.map((section, idx) => (
            <SectionCard
              key={section.id}
              section={section}
              index={idx}
              total={sections.length}
              isEditing={editingSectionId === section.id}
              onEdit={() => setEditingSectionId(section.id)}
              onSave={(data) => handleSaveSection(section.id, data)}
              onCancel={() => setEditingSectionId(null)}
              onDelete={() => handleDeleteSection(section.id)}
              onMove={(dir) => handleMoveSection(idx, dir)}
              docId={id}
              isNewDoc={isNew}
              docContext={{ title, docType, summary, sections }}
            />
          ))}

          <button
            onClick={handleAddSection}
            className="w-full py-3 border-2 border-dashed border-gray-700 rounded-xl text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors text-sm"
          >
            + Add Section
          </button>
        </div>
      )}

      {activeTab === 'linked' && (
        <div className="space-y-4">
          {/* Search to link */}
          {!isNew && (
            <div className="flex gap-2">
              <input
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchEntities()}
                placeholder="Search patterns, technologies, PBCs..."
                className="input flex-1"
              />
              <button onClick={handleSearchEntities} disabled={linkSearching} className="btn-secondary text-sm">
                {linkSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          )}

          {/* Search results */}
          {linkResults.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {linkResults.map(r => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-sm text-white">{r.name}</span>
                    <span className="text-xs text-gray-500 ml-2 font-mono">{r.id}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                      r.label === 'Pattern' ? 'bg-blue-500/10 text-blue-400'
                      : r.label === 'Technology' ? 'bg-purple-500/10 text-purple-400'
                      : 'bg-green-500/10 text-green-400'
                    }`}>{r.label}</span>
                  </div>
                  <button onClick={() => handleLinkEntity(r)} className="text-xs text-blue-400 hover:text-blue-300">
                    Link
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Linked entities */}
          {linkedEntities.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No linked entities yet. Search above to link patterns, technologies, or PBCs.</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {linkedEntities.map(e => (
                <div key={e.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      e.label === 'Pattern' ? 'bg-blue-500/10 text-blue-400'
                      : e.label === 'Technology' ? 'bg-purple-500/10 text-purple-400'
                      : 'bg-green-500/10 text-green-400'
                    }`}>{e.label}</span>
                    <span className="text-sm text-white">{e.name || e.id}</span>
                    <span className="text-xs text-gray-500 font-mono">{e.id}</span>
                  </div>
                  <button onClick={() => handleUnlinkEntity(e.id)} className="text-xs text-red-400 hover:text-red-300">
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Section Card Component ──

function SectionCard({ section, index, total, isEditing, onEdit, onSave, onCancel, onDelete, onMove, docId, isNewDoc, docContext }) {
  const [editTitle, setEditTitle] = useState(section.title || '')
  const [editContent, setEditContent] = useState(section.content || '')
  const [showDiagramMenu, setShowDiagramMenu] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiBadge, setAiBadge] = useState(null)
  const [showCustomPrompt, setShowCustomPrompt] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [previousContent, setPreviousContent] = useState(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    setEditTitle(section.title || '')
    setEditContent(section.content || '')
  }, [section, isEditing])

  const insertDiagram = (type) => {
    const template = DIAGRAM_TEMPLATES[type]
    if (!template) return
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const before = editContent.slice(0, start)
      const after = editContent.slice(textarea.selectionEnd)
      const newContent = before + (before && !before.endsWith('\n') ? '\n\n' : '') + template + '\n\n' + after
      setEditContent(newContent)
    } else {
      setEditContent(prev => prev + (prev ? '\n\n' : '') + template + '\n')
    }
    setShowDiagramMenu(false)
  }

  const callAiAssist = async (action, customText) => {
    setAiLoading(true)
    setAiBadge(null)
    try {
      const otherSections = (docContext?.sections || [])
        .filter(s => s.id !== section.id)
        .map(s => ({ title: s.title, content_preview: (s.content || '').slice(0, 200) }))

      const res = await aiDocumentSectionAssist({
        action,
        section_title: editTitle || 'Untitled',
        current_value: editContent || '',
        custom_prompt: customText || null,
        doc_title: docContext?.title || '',
        doc_type: docContext?.docType || 'guide',
        doc_summary: docContext?.summary || '',
        other_sections: otherSections,
      })
      setPreviousContent(editContent)
      setEditContent(res.content)
      setAiBadge('applied')
      setTimeout(() => setAiBadge(null), 3000)
    } catch (err) {
      console.error('AI Section Assist error:', err)
      setAiBadge('error')
      setTimeout(() => setAiBadge(null), 3000)
    }
    setAiLoading(false)
    setShowCustomPrompt(false)
    setCustomPrompt('')
  }

  if (isEditing) {
    return (
      <div className="bg-gray-900 border border-blue-500/30 rounded-xl overflow-hidden">
        {/* Section header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900/80">
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            className="text-sm font-medium text-white bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none flex-1"
            placeholder="Section title..."
          />
          <div className="flex items-center gap-1.5">
            <button onClick={() => onSave({ title: editTitle, content: editContent })} className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors">
              Save
            </button>
            <button onClick={onCancel} className="text-xs px-2.5 py-1 rounded bg-gray-800 text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800 bg-gray-950/50">
          <ToolbarButton label="B" title="Bold" onClick={() => wrapSelection(textareaRef, '**', '**', editContent, setEditContent)} bold />
          <ToolbarButton label="I" title="Italic" onClick={() => wrapSelection(textareaRef, '_', '_', editContent, setEditContent)} italic />
          <ToolbarButton label="<>" title="Code" onClick={() => wrapSelection(textareaRef, '`', '`', editContent, setEditContent)} mono />
          <ToolbarButton label="#" title="Heading" onClick={() => insertAtLineStart(textareaRef, '### ', editContent, setEditContent)} />
          <ToolbarButton label="—" title="Horizontal Rule" onClick={() => insertText(textareaRef, '\n\n---\n\n', editContent, setEditContent)} />
          <div className="w-px h-4 bg-gray-700 mx-1" />

          {/* Insert Diagram dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDiagramMenu(v => !v)}
              className="text-[11px] px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors flex items-center gap-1"
              title="Insert Diagram"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              Insert Diagram
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showDiagramMenu && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg py-1 shadow-xl min-w-[160px]">
                {[
                  ['flowchart', 'Flowchart'],
                  ['sequence', 'Sequence Diagram'],
                  ['classDiagram', 'Class Diagram'],
                  ['stateDiagram', 'State Diagram'],
                  ['erDiagram', 'ER Diagram'],
                  ['gantt', 'Gantt Chart'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => insertDiagram(key)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          {/* AI Assist buttons */}
          <button
            onClick={() => callAiAssist('suggest')}
            disabled={aiLoading}
            className="text-[11px] px-2 py-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center gap-1 disabled:opacity-50"
            title="AI: Generate content for this section"
          >
            <span className="text-sm">&#10024;</span> Suggest
          </button>
          <button
            onClick={() => callAiAssist('improve')}
            disabled={aiLoading || !editContent?.trim()}
            className="text-[11px] px-2 py-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center gap-1 disabled:opacity-50"
            title="AI: Improve existing content"
          >
            <span className="text-sm">&#9998;</span> Improve
          </button>
          <button
            onClick={() => setShowCustomPrompt(v => !v)}
            disabled={aiLoading}
            className={`text-[11px] px-2 py-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center gap-1 disabled:opacity-50 ${showCustomPrompt ? 'bg-purple-500/10' : ''}`}
            title="AI: Custom instruction"
          >
            <span className="text-sm">&#128172;</span> Custom
          </button>
          {previousContent !== null && (
            <button
              onClick={() => { setEditContent(previousContent); setPreviousContent(null) }}
              disabled={aiLoading}
              className="text-[11px] px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
              title="Undo AI change"
            >
              &#8617; Undo
            </button>
          )}

          {/* AI status */}
          {aiLoading && (
            <span className="text-[11px] text-purple-400 flex items-center gap-1 ml-1">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Generating...
            </span>
          )}
          {aiBadge === 'applied' && <span className="text-[11px] text-green-400 ml-1">&#10003; Applied</span>}
          {aiBadge === 'error' && <span className="text-[11px] text-red-400 ml-1">&#10007; Failed</span>}
        </div>

        {/* Custom prompt input */}
        {showCustomPrompt && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950/30">
            <input
              type="text"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && customPrompt.trim() && callAiAssist('custom', customPrompt.trim())}
              placeholder="e.g. add a mermaid diagram, make more concise, add security considerations..."
              className="input flex-1 text-xs"
              autoFocus
            />
            <button
              onClick={() => customPrompt.trim() && callAiAssist('custom', customPrompt.trim())}
              disabled={aiLoading || !customPrompt.trim()}
              className="text-xs px-2.5 py-1 rounded bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={() => { setShowCustomPrompt(false); setCustomPrompt('') }}
              className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Split pane: Editor + Preview */}
        <div className="grid grid-cols-2 divide-x divide-gray-800 min-h-[300px]">
          {/* Editor */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full h-full min-h-[300px] bg-gray-950 text-gray-300 text-sm font-mono p-4 resize-none outline-none"
              placeholder="Write markdown content here... Use the toolbar to insert diagrams."
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const start = e.target.selectionStart
                  const before = editContent.slice(0, start)
                  const after = editContent.slice(e.target.selectionEnd)
                  setEditContent(before + '  ' + after)
                  setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = start + 2 }, 0)
                }
              }}
            />
          </div>

          {/* Preview */}
          <div className="p-4 overflow-auto bg-gray-900/50 max-h-[500px]">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Preview</div>
            {editContent ? (
              <MarkdownContent content={editContent} />
            ) : (
              <p className="text-gray-600 text-sm italic">Preview will appear here...</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // View mode
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden group hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-600 font-mono">S{String(index + 1).padStart(2, '0')}</span>
          <h3 className="text-sm font-medium text-white">{section.title || 'Untitled Section'}</h3>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {index > 0 && (
            <button onClick={() => onMove(-1)} className="p-1 text-gray-500 hover:text-gray-300" title="Move up">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
          )}
          {index < total - 1 && (
            <button onClick={() => onMove(1)} className="p-1 text-gray-500 hover:text-gray-300" title="Move down">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          <button onClick={onEdit} className="p-1 text-gray-500 hover:text-blue-400" title="Edit section">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button onClick={onDelete} className="p-1 text-gray-500 hover:text-red-400" title="Delete section">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div className="p-4">
        {section.content ? (
          <MarkdownContent content={section.content} />
        ) : (
          <p className="text-gray-600 text-sm italic">No content yet. Click edit to add content.</p>
        )}
      </div>
    </div>
  )
}


// ── Toolbar helpers ──

function ToolbarButton({ label, title, onClick, bold, italic, mono }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors ${
        bold ? 'font-bold' : ''
      } ${italic ? 'italic' : ''} ${mono ? 'font-mono' : ''}`}
    >
      {label}
    </button>
  )
}

function wrapSelection(textareaRef, before, after, content, setContent) {
  const textarea = textareaRef.current
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = content.slice(start, end) || 'text'
  const newContent = content.slice(0, start) + before + selected + after + content.slice(end)
  setContent(newContent)
  setTimeout(() => {
    textarea.focus()
    textarea.selectionStart = start + before.length
    textarea.selectionEnd = start + before.length + selected.length
  }, 0)
}

function insertAtLineStart(textareaRef, prefix, content, setContent) {
  const textarea = textareaRef.current
  if (!textarea) return
  const start = textarea.selectionStart
  const lineStart = content.lastIndexOf('\n', start - 1) + 1
  const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart)
  setContent(newContent)
  setTimeout(() => {
    textarea.focus()
    textarea.selectionStart = textarea.selectionEnd = start + prefix.length
  }, 0)
}

function insertText(textareaRef, text, content, setContent) {
  const textarea = textareaRef.current
  if (!textarea) return
  const start = textarea.selectionStart
  const newContent = content.slice(0, start) + text + content.slice(textarea.selectionEnd)
  setContent(newContent)
  setTimeout(() => {
    textarea.focus()
    textarea.selectionStart = textarea.selectionEnd = start + text.length
  }, 0)
}
