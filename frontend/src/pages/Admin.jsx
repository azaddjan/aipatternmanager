import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAdminSettings, updateAdminSettings, setApiKey, testProvider,
  exportHtmlUrl, exportPptxUrl, exportDocxUrl,
  importPreview, importBackup,
  createBackup, fetchBackups, downloadBackupUrl, deleteBackup, restoreBackup,
  fetchSystemStatus, embedMissingNodes, embedAllNodes,
  fetchAdvisorReports, updateAdvisorReport,
  deleteAdvisorReport, deleteAllAdvisorReports, cleanupAdvisorReports,
  advisorReportExportHtmlUrl, advisorReportExportDocxUrl,
  authenticatedDownload,
  fetchPrompts, updatePrompt, resetPrompt, testPrompt,
  fetchTeams,
} from '../api/client'
import ConfirmModal from '../components/ConfirmModal'

const PROVIDER_LABELS = {
  anthropic: { label: 'Anthropic (Claude)', icon: '🟣' },
  openai: { label: 'OpenAI', icon: '🟢' },
  ollama: { label: 'Ollama (Local)', icon: '🦙' },
  bedrock: { label: 'AWS Bedrock', icon: '☁️' },
}

const CONFIDENCE_COLORS = {
  HIGH: 'bg-green-500/20 text-green-400 border-green-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const TABS = [
  { key: 'config', label: 'Configuration', icon: '⚙️' },
  { key: 'export', label: 'Export', icon: '📤' },
  { key: 'import', label: 'Backup', icon: '💾' },
  { key: 'status', label: 'System Status', icon: '📊' },
  { key: 'prompts', label: 'AI Prompts', icon: '📝' },
  { key: 'advisor', label: 'Advisor', icon: '🧠' },
]

export default function Admin() {
  const [tab, setTab] = useState('config')
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // API key form
  const [keyForm, setKeyForm] = useState({ provider: '', key: '', secret: '' })
  const [showKeyForm, setShowKeyForm] = useState(false)

  // Provider test
  const [testing, setTesting] = useState('')  // provider name being tested
  const [testResult, setTestResult] = useState(null)  // { provider, status, message, ... }

  // Import — multi-step state
  const [importStep, setImportStep] = useState('upload') // upload | preview | importing | results
  const [importFile, setImportFile] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [importIncludes, setImportIncludes] = useState({ teams: true, users: true, settings: true, patterns: true, technologies: true, pbcs: true, categories: true, advisor_reports: true, health_analyses: true })
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // Backup history
  const [backups, setBackups] = useState([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [backupName, setBackupName] = useState('')
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(null)

  // System status
  const [systemStatus, setSystemStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [embedding, setEmbedding] = useState('') // 'missing' | 'all' | ''
  const [embedResult, setEmbedResult] = useState(null)

  // Advisor reports
  const [advisorReports, setAdvisorReports] = useState([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [editingReportTitle, setEditingReportTitle] = useState(null)
  const [editReportTitleValue, setEditReportTitleValue] = useState('')
  const [cleanupResult, setCleanupResult] = useState(null)
  const [retentionForm, setRetentionForm] = useState({ max_reports: 20, retention_days: 30, auto_cleanup: true })
  const [retentionDirty, setRetentionDirty] = useState(false)

  // AI Prompts
  const [promptsData, setPromptsData] = useState(null)
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [selectedPrompt, setSelectedPrompt] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [testingPrompt, setTestingPrompt] = useState(false)
  const [testResponse, setTestResponse] = useState(null)
  const [promptFilter, setPromptFilter] = useState('')

  // Export team filter
  const [exportTeams, setExportTeams] = useState([])
  const [selectedExportTeams, setSelectedExportTeams] = useState([])

  // Generic confirm modal state: { title, message, confirmLabel, variant, onConfirm }
  const [confirmAction, setConfirmAction] = useState(null)

  const liveTokenEstimate = useMemo(() => {
    if (!editValue) return 0
    return Math.round(editValue.split(/\s+/).filter(Boolean).length * 1.3)
  }, [editValue])

  const loadSystemStatus = useCallback(() => {
    setLoadingStatus(true)
    fetchSystemStatus()
      .then(s => { setSystemStatus(s); setLoadingStatus(false) })
      .catch(() => setLoadingStatus(false))
  }, [])

  const handleEmbedMissing = async () => {
    setEmbedding('missing')
    setEmbedResult(null)
    try {
      const result = await embedMissingNodes()
      setEmbedResult({ type: 'missing', ...result })
      loadSystemStatus() // refresh stats
    } catch (err) {
      setEmbedResult({ type: 'missing', status: 'error', message: err.message })
    }
    setEmbedding('')
  }

  const handleEmbedAll = () => {
    setConfirmAction({
      title: 'Re-embed All Nodes',
      message: 'Re-embed ALL nodes? This will call the embedding provider API for every node and may take a moment. Existing embeddings will be cleared and vector indexes recreated.',
      confirmLabel: 'Re-embed All',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmAction(null)
        setEmbedding('all')
        setEmbedResult(null)
        try {
          const result = await embedAllNodes()
          setEmbedResult({ type: 'all', ...result })
          loadSystemStatus()
        } catch (err) {
          setEmbedResult({ type: 'all', status: 'error', message: err.message })
        }
        setEmbedding('')
      },
    })
  }

  const load = () => {
    fetchAdminSettings()
      .then(s => { setSettings(s); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const loadBackups = useCallback(() => {
    setLoadingBackups(true)
    fetchBackups()
      .then(list => { setBackups(list); setLoadingBackups(false) })
      .catch(() => setLoadingBackups(false))
  }, [])

  useEffect(() => { load() }, [])
  useEffect(() => {
    fetchTeams().then(t => setExportTeams(t)).catch(() => {})
  }, [])
  useEffect(() => { if (tab === 'import') loadBackups() }, [tab, loadBackups])
  useEffect(() => { if (tab === 'status') loadSystemStatus() }, [tab, loadSystemStatus])
  useEffect(() => {
    if (tab === 'advisor') {
      loadAdvisorReports()
      if (settings?.report_retention) {
        setRetentionForm({
          max_reports: settings.report_retention.max_reports ?? 20,
          retention_days: settings.report_retention.retention_days ?? 30,
          auto_cleanup: settings.report_retention.auto_cleanup ?? true,
        })
        setRetentionDirty(false)
      }
    }
  }, [tab, settings])

  // Prompts tab data loading
  const loadPrompts = useCallback(() => {
    setLoadingPrompts(true)
    fetchPrompts()
      .then(data => { setPromptsData(data); setLoadingPrompts(false) })
      .catch(() => setLoadingPrompts(false))
  }, [])

  useEffect(() => { if (tab === 'prompts') loadPrompts() }, [tab, loadPrompts])

  const handleSelectPrompt = (section, sub_prompt) => {
    const prompt = promptsData?.prompts?.find(p => p.section === section && p.sub_prompt === sub_prompt)
    if (prompt) {
      setSelectedPrompt({ section, sub_prompt })
      setEditValue(prompt.current_value)
      setPromptDirty(false)
      setTestResponse(null)
    }
  }

  const handleSavePrompt = async () => {
    if (!selectedPrompt) return
    setSavingPrompt(true)
    try {
      await updatePrompt(selectedPrompt.section, selectedPrompt.sub_prompt, editValue)
      setMsg('Prompt saved successfully')
      setPromptDirty(false)
      loadPrompts()
    } catch (err) {
      setMsg(`Failed to save prompt: ${err.message}`)
    }
    setSavingPrompt(false)
  }

  const handleResetPrompt = () => {
    if (!selectedPrompt) return
    setConfirmAction({
      title: 'Reset Prompt',
      message: 'Reset this prompt to the YAML default? Your override will be deleted.',
      confirmLabel: 'Reset',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmAction(null)
        setSavingPrompt(true)
        try {
          const result = await resetPrompt(selectedPrompt.section, selectedPrompt.sub_prompt)
          setEditValue(result.current_value)
          setPromptDirty(false)
          setMsg('Prompt reset to default')
          loadPrompts()
        } catch (err) {
          setMsg(`Failed to reset: ${err.message}`)
        }
        setSavingPrompt(false)
      },
    })
  }

  const handleTestPrompt = async () => {
    if (!editValue.trim()) return
    setTestingPrompt(true)
    setTestResponse(null)
    try {
      const isSystem = selectedPrompt?.sub_prompt === 'system'
      const systemText = isSystem
        ? editValue
        : (promptsData?.prompts?.find(p => p.section === selectedPrompt?.section && p.sub_prompt === 'system')?.current_value || 'You are a helpful assistant.')
      const userText = isSystem
        ? 'Hello, please confirm you understand your role. Respond briefly.'
        : 'This is a test of the prompt template. Please respond briefly confirming you understand the instructions.'
      const result = await testPrompt(systemText, userText)
      setTestResponse(result)
    } catch (err) {
      setTestResponse({ status: 'error', response: err.message })
    }
    setTestingPrompt(false)
  }

  /* ---------- Config handlers ---------- */

  const handleSetDefault = async (provName) => {
    setSaving(true)
    setMsg('')
    try {
      const updated = await updateAdminSettings({ default_provider: provName })
      setSettings(updated)
      setMsg(`Default provider set to ${provName}`)
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleModelChange = async (provName, model) => {
    setSaving(true)
    try {
      const updated = await updateAdminSettings({
        providers: { [provName]: { model } }
      })
      setSettings(updated)
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleSaveKey = async () => {
    setSaving(true)
    setMsg('')
    try {
      const updated = await setApiKey(keyForm.provider, keyForm.key, keyForm.secret || null)
      setSettings(updated)
      setKeyForm({ provider: '', key: '', secret: '' })
      setShowKeyForm(false)
      setMsg('API key saved successfully')
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleEmbeddingProviderChange = async (provider) => {
    setSaving(true)
    try {
      const updated = await updateAdminSettings({
        embedding: { provider }
      })
      setSettings(updated)
      setMsg('Embedding provider changed — re-embed all nodes via System Status to apply')
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleEmbeddingModelChange = async (model) => {
    setSaving(true)
    try {
      const updated = await updateAdminSettings({
        embedding: { model }
      })
      setSettings(updated)
      setMsg('Embedding model updated — re-embed all nodes via System Status to apply')
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleTestProvider = async (provName) => {
    setTesting(provName)
    setTestResult(null)
    try {
      const result = await testProvider(provName)
      setTestResult({ provider: provName, ...result })
    } catch (err) {
      setTestResult({ provider: provName, status: 'error', message: err.message })
    }
    setTesting('')
  }

  /* ---------- Import handlers (multi-step) ---------- */

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file && (file.name.endsWith('.json') || file.name.endsWith('.json.gz'))) {
      setImportFile(file)
      setPreviewData(null)
      setImportResult(null)
      setImportStep('upload')
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0] || null
    setImportFile(file)
    setPreviewData(null)
    setImportResult(null)
    setImportStep('upload')
  }

  const handlePreview = async () => {
    if (!importFile) return
    setPreviewing(true)
    setMsg('')
    try {
      const data = await importPreview(importFile)
      setPreviewData(data)
      setImportIncludes({ teams: true, users: true, settings: true, patterns: true, technologies: true, pbcs: true, categories: true, advisor_reports: true, health_analyses: true })
      setImportStep('preview')
    } catch (err) {
      setMsg(`Preview failed: ${err.message}`)
    }
    setPreviewing(false)
  }

  const handleImport = async () => {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    setMsg('')
    try {
      const include = Object.entries(importIncludes)
        .filter(([, v]) => v)
        .map(([k]) => k)
      const result = await importBackup(importFile, include)
      setImportResult(result.details || result)
      setImportStep('results')
      setMsg('Import completed successfully')
      setImportFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadBackups() // refresh backup list (auto-backup was created)
    } catch (err) {
      setMsg(err.message)
      setImportResult({ error: err.message })
      setImportStep('results')
    }
    setImporting(false)
  }

  const resetImport = () => {
    setImportFile(null)
    setPreviewData(null)
    setImportResult(null)
    setImportStep('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* ---------- Backup handlers ---------- */

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    setMsg('')
    try {
      const result = await createBackup(backupName)
      setBackupName('')
      setMsg('Backup created — downloading...')
      loadBackups()
      // Auto-download the backup file
      if (result?.filename) {
        await authenticatedDownload(downloadBackupUrl(result.filename), result.filename)
      }
    } catch (err) {
      setMsg(`Backup failed: ${err.message}`)
    }
    setCreatingBackup(false)
  }

  const handleDeleteBackup = (filename) => {
    setConfirmAction({
      title: 'Delete Backup',
      message: `Are you sure you want to delete backup "${filename}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          await deleteBackup(filename)
          setMsg('Backup deleted')
          loadBackups()
        } catch (err) {
          setMsg(`Delete failed: ${err.message}`)
        }
      },
    })
  }

  const handleRestoreBackup = (filename) => {
    setConfirmAction({
      title: 'Restore Backup',
      message: `Restore from "${filename}"? A safety backup of your current data will be created first.`,
      confirmLabel: 'Restore',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmAction(null)
        setRestoringBackup(filename)
        setMsg('')
        try {
          const result = await restoreBackup(filename)
          const d = result.details || result
          setMsg(`Restore completed — ${d.patterns_imported || 0} patterns, ${d.technologies_imported || 0} technologies, ${d.pbcs_imported || 0} PBCs, ${d.categories_imported || 0} categories, ${d.relationships_imported || 0} relationships, ${d.teams_imported || 0} teams, ${d.users_imported || 0} users restored`)
          loadBackups()
        } catch (err) {
          setMsg(`Restore failed: ${err.message}`)
        }
        setRestoringBackup(null)
      },
    })
  }

  /* ---------- Helpers ---------- */

  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  const formatDate = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  const countPreviewType = (type) => {
    if (!previewData || !previewData[type]) return { new: 0, updated: 0, unchanged: 0 }
    const t = previewData[type]
    return { new: t.new?.length || 0, updated: t.updated?.length || 0, unchanged: t.unchanged?.length || 0 }
  }

  /* ---------- Advisor Report Handlers ---------- */

  const loadAdvisorReports = () => {
    setLoadingReports(true)
    fetchAdvisorReports(200)
      .then(r => { setAdvisorReports(r?.reports || []); setLoadingReports(false) })
      .catch(() => setLoadingReports(false))
  }

  const handleRetentionChange = (field, value) => {
    setRetentionForm(prev => ({ ...prev, [field]: value }))
    setRetentionDirty(true)
  }

  const handleSaveRetention = async () => {
    setSaving(true)
    setMsg('')
    try {
      const updated = await updateAdminSettings({
        report_retention: {
          max_reports: parseInt(retentionForm.max_reports, 10) || 20,
          retention_days: parseInt(retentionForm.retention_days, 10) || 30,
          auto_cleanup: retentionForm.auto_cleanup,
        }
      })
      setSettings(updated)
      setRetentionDirty(false)
      setMsg('Retention policy saved successfully')
    } catch (err) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleAdvisorToggleStar = async (id) => {
    const rpt = advisorReports.find(r => r.id === id)
    if (!rpt) return
    const newStarred = !rpt.starred
    setAdvisorReports(prev =>
      prev.map(r => r.id === id ? { ...r, starred: newStarred } : r)
        .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (b.created_at || '').localeCompare(a.created_at || ''))
    )
    try {
      await updateAdvisorReport(id, { starred: newStarred })
    } catch {
      setAdvisorReports(prev =>
        prev.map(r => r.id === id ? { ...r, starred: !newStarred } : r)
      )
    }
  }

  const handleAdvisorRenameReport = async (id) => {
    if (!editReportTitleValue.trim()) {
      setEditingReportTitle(null)
      return
    }
    try {
      await updateAdvisorReport(id, { title: editReportTitleValue.trim() })
      setAdvisorReports(prev =>
        prev.map(r => r.id === id ? { ...r, title: editReportTitleValue.trim() } : r)
      )
    } catch {
      // ignore
    }
    setEditingReportTitle(null)
  }

  const handleAdvisorDeleteReport = (id) => {
    setConfirmAction({
      title: 'Delete Report',
      message: `Are you sure you want to delete report "${id}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          await deleteAdvisorReport(id)
          setAdvisorReports(prev => prev.filter(r => r.id !== id))
        } catch (err) {
          setMsg(`Failed to delete: ${err.message}`)
        }
      },
    })
  }

  const handleAdvisorDeleteAll = () => {
    setConfirmAction({
      title: 'Delete All Reports',
      message: 'Delete all non-starred reports? Starred reports will be kept.',
      confirmLabel: 'Delete All',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          const result = await deleteAllAdvisorReports()
          setMsg(`Deleted ${result.deleted || 0} non-starred reports`)
          loadAdvisorReports()
        } catch (err) {
          setMsg(`Failed to delete all: ${err.message}`)
        }
      },
    })
  }

  const handleAdvisorCleanup = async () => {
    setCleanupResult(null)
    try {
      const res = await cleanupAdvisorReports()
      setCleanupResult(res)
      setMsg(`Cleanup complete: ${(res.deleted_by_count || 0) + (res.deleted_by_age || 0)} reports removed, ${res.total_remaining || 0} remaining`)
      loadAdvisorReports()
    } catch (err) {
      setMsg(`Cleanup failed: ${err.message}`)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading admin settings...</div>

  const providers = settings?.providers || {}
  const defaultProvider = settings?.default_provider || 'anthropic'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Dashboard</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">Administration</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white">Administration</h1>
        <p className="text-gray-500 text-sm mt-1">Manage providers, export data, and import backups</p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-900/50 rounded-lg p-1 border border-gray-800">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error')
            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
            : 'bg-green-500/10 border border-green-500/30 text-green-400'
        }`}>
          {msg}
          <button onClick={() => setMsg('')} className="float-right text-gray-500 hover:text-gray-300">✕</button>
        </div>
      )}

      {/* ============ Configuration Tab ============ */}
      {tab === 'config' && (
        <div className="space-y-6">

          {/* --- LLM Providers Section --- */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">LLM Providers</h2>
            <p className="text-gray-500 text-xs mb-4">Configure language model providers for AI authoring, discovery, and advisor features.</p>
          </div>

          {Object.entries(providers).map(([name, config]) => {
            const info = PROVIDER_LABELS[name] || { label: name, icon: '🔧' }
            const isDefault = name === defaultProvider
            return (
              <div key={name} className={`card border-l-4 ${isDefault ? 'border-blue-500' : 'border-gray-700'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{info.icon}</span>
                      <div>
                        <h3 className="font-semibold text-white">{info.label}</h3>
                        {isDefault && (
                          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">Default</span>
                        )}
                      </div>
                    </div>

                    {/* Model selector */}
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-xs text-gray-500">Model:</label>
                      <select
                        value={config.model || ''}
                        onChange={e => handleModelChange(name, e.target.value)}
                        className="select text-sm"
                      >
                        {(config.models || []).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {/* API Key Status */}
                    {name !== 'ollama' && (
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-gray-500">API Key:</span>
                        {config.key_set ? (
                          <span className="text-xs font-mono text-green-400">
                            {config.masked_key || '****'}
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-400">Not set</span>
                        )}
                        <button
                          onClick={() => {
                            setKeyForm({ provider: name, key: '', secret: '' })
                            setShowKeyForm(true)
                          }}
                          className="text-xs text-blue-400 hover:underline"
                        >
                          {config.key_set ? 'Change' : 'Set Key'}
                        </button>
                      </div>
                    )}

                    {/* Ollama base URL */}
                    {name === 'ollama' && (
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-gray-500">Base URL:</span>
                        <span className="text-xs font-mono text-gray-400">
                          {config.base_url || 'http://localhost:11434'}
                        </span>
                      </div>
                    )}

                    {/* Bedrock region */}
                    {name === 'bedrock' && (
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-gray-500">Region:</span>
                        <span className="text-xs font-mono text-gray-400">
                          {config.region || 'us-east-1'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 items-end">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefault(name)}
                        disabled={saving}
                        className="btn-secondary text-xs"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => handleTestProvider(name)}
                      disabled={testing === name}
                      className="btn-secondary text-xs"
                    >
                      {testing === name ? (
                        <span className="flex items-center gap-1">
                          <span className="animate-spin">&#9696;</span> Testing...
                        </span>
                      ) : '🧪 Test'}
                    </button>
                    <span className={`text-xs text-center ${config.key_set || name === 'ollama' ? 'text-green-400' : 'text-gray-600'}`}>
                      {config.key_set || name === 'ollama' ? '● Ready' : '○ Needs Key'}
                    </span>
                  </div>
                </div>

                {/* Test Result */}
                {testResult && testResult.provider === name && (
                  <div className={`mt-3 rounded-lg px-4 py-3 text-sm flex items-center justify-between ${
                    testResult.status === 'ok'
                      ? 'bg-green-500/10 border border-green-500/30'
                      : 'bg-red-500/10 border border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={testResult.status === 'ok' ? 'text-green-400' : 'text-red-400'}>
                        {testResult.status === 'ok' ? '✓' : '✕'}
                      </span>
                      <span className={testResult.status === 'ok' ? 'text-green-400' : 'text-red-400'}>
                        {testResult.message}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {testResult.model && <span>Model: {testResult.model}</span>}
                      {testResult.latency_ms != null && <span>{testResult.latency_ms}ms</span>}
                      <button onClick={() => setTestResult(null)} className="text-gray-500 hover:text-gray-300">✕</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* API Key Form Modal */}
          {showKeyForm && (
            <div className="card border border-blue-500/30 space-y-4">
              <h3 className="text-sm font-semibold text-gray-400">
                Set API Key — {PROVIDER_LABELS[keyForm.provider]?.label || keyForm.provider}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {keyForm.provider === 'bedrock' ? 'AWS Access Key ID' : 'API Key'}
                  </label>
                  <input
                    type="password"
                    value={keyForm.key}
                    onChange={e => setKeyForm(f => ({ ...f, key: e.target.value }))}
                    placeholder="Enter API key..."
                    className="input w-full"
                    autoComplete="off"
                  />
                </div>
                {keyForm.provider === 'bedrock' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">AWS Secret Access Key</label>
                    <input
                      type="password"
                      value={keyForm.secret}
                      onChange={e => setKeyForm(f => ({ ...f, secret: e.target.value }))}
                      placeholder="Enter secret key..."
                      className="input w-full"
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveKey} disabled={saving || !keyForm.key} className="btn-primary">
                  {saving ? 'Saving...' : 'Save Key'}
                </button>
                <button onClick={() => setShowKeyForm(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Keys are stored in runtime environment only and shown as *** after saving.
              </p>
            </div>
          )}

          {/* --- Embedding Model Section --- */}
          <div className="border-t border-gray-800 pt-6">
            <h2 className="text-lg font-semibold text-white mb-1">Embedding Model</h2>
            <p className="text-gray-500 text-xs mb-4">Configure the vector embedding model used for semantic search in Pattern Advisor (GraphRAG).</p>
          </div>

          {(() => {
            const embConfig = settings?.embedding || {}
            const embProvider = embConfig.provider || 'openai'
            const embModel = embConfig.model || 'text-embedding-3-small'
            const embProviders = embConfig.embedding_providers || {}
            const currentProvModels = embProviders[embProvider]?.models || []
            // Find dimensions for current model
            const currentModelInfo = currentProvModels.find(m => m.id === embModel)
            const dims = currentModelInfo?.dimensions || 1536

            // Determine key status per provider
            let keySet = false
            let keyStatusText = ''
            if (embProvider === 'openai') {
              keySet = providers?.openai?.key_set || false
              keyStatusText = keySet
                ? 'Uses OpenAI API key (shared with LLM provider above)'
                : 'Not set — configure OpenAI key above'
            } else if (embProvider === 'ollama') {
              keySet = true
              keyStatusText = 'No API key required (local model)'
            } else if (embProvider === 'bedrock') {
              keySet = providers?.bedrock?.key_set || false
              keyStatusText = keySet
                ? 'Uses AWS credentials (shared with Bedrock LLM provider above)'
                : 'Not set — configure AWS credentials above'
            }

            const providerIcons = { openai: '🟢', ollama: '🦙', bedrock: '☁️' }
            const providerNames = { openai: 'OpenAI', ollama: 'Ollama (Local)', bedrock: 'AWS Bedrock' }

            return (
              <div className="card border-l-4 border-purple-500">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">🧬</span>
                      <div>
                        <h3 className="font-semibold text-white">Vector Embeddings</h3>
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Semantic Search</span>
                      </div>
                    </div>

                    {/* Provider selector */}
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-xs text-gray-500">Provider:</label>
                      <div className="flex gap-1">
                        {Object.keys(embProviders).map(prov => (
                          <button
                            key={prov}
                            onClick={() => handleEmbeddingProviderChange(prov)}
                            disabled={saving}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
                              embProvider === prov
                                ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                                : 'bg-gray-800/60 text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300'
                            }`}
                          >
                            <span>{providerIcons[prov] || '🔧'}</span>
                            <span>{providerNames[prov] || prov}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Model selector */}
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-xs text-gray-500">Model:</label>
                      <select
                        value={embModel}
                        onChange={e => handleEmbeddingModelChange(e.target.value)}
                        className="select text-sm"
                      >
                        {currentProvModels.map(m => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                      </select>
                    </div>

                    {/* Dimensions info */}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-gray-500">Dimensions:</span>
                      <span className="text-xs font-mono text-gray-400">{dims}</span>
                    </div>

                    {/* API Key / Credentials status */}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-gray-500">
                        {embProvider === 'bedrock' ? 'Credentials:' : 'API Key:'}
                      </span>
                      <span className={`text-xs ${keySet ? 'text-green-400' : 'text-yellow-400'}`}>
                        {keyStatusText}
                      </span>
                    </div>
                  </div>

                  <span className={`text-xs text-center ${keySet ? 'text-green-400' : 'text-gray-600'}`}>
                    {keySet ? '● Ready' : '○ Needs Key'}
                  </span>
                </div>

                <div className="mt-3 rounded-lg px-4 py-3 text-xs bg-purple-500/5 border border-purple-500/20 text-purple-300">
                  <strong>Note:</strong> Changing the embedding provider or model requires re-embedding all nodes via System Status → Re-embed All Nodes.
                  Different models produce different vector dimensions — existing embeddings will be cleared automatically on re-embed.
                </div>
              </div>
            )
          })()}

          {/* --- Authentication Settings --- */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white mb-1">Authentication</h2>
            <p className="text-gray-500 text-xs mb-4">Configure authentication behavior for the application.</p>
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">Allow Anonymous Read Access</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    When enabled, unauthenticated users can view patterns, technologies, and the graph without logging in.
                    Write operations always require authentication.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const current = settings?.auth?.allow_anonymous_read ?? false
                      const updated = await updateAdminSettings({
                        auth: { allow_anonymous_read: !current },
                      })
                      setSettings(updated)
                      setMsg(!current ? 'Anonymous read access enabled' : 'Anonymous read access disabled')
                    } catch (err) {
                      setMsg('Failed to update: ' + err.message)
                    }
                    setSaving(false)
                  }}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings?.auth?.allow_anonymous_read ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings?.auth?.allow_anonymous_read ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ Export Tab ============ */}
      {tab === 'export' && (
        <div className="space-y-4">
          <p className="text-gray-500 text-sm">
            Export patterns, technologies, and business capabilities in various formats.
          </p>

          {/* Team filter */}
          {exportTeams.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-400">Export Scope:</span>
                <button
                  onClick={() => setSelectedExportTeams([])}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    selectedExportTeams.length === 0
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'border-gray-600 text-gray-500 hover:border-gray-500'
                  }`}
                >
                  All Teams
                </button>
                {exportTeams.map(team => {
                  const isSelected = selectedExportTeams.includes(team.id)
                  return (
                    <button
                      key={team.id}
                      onClick={() => setSelectedExportTeams(prev =>
                        isSelected ? prev.filter(id => id !== team.id) : [...prev, team.id]
                      )}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                          : 'border-gray-600 text-gray-500 hover:border-gray-500'
                      }`}
                    >
                      {team.name}
                    </button>
                  )
                })}
                {selectedExportTeams.length > 0 && (
                  <span className="text-xs text-gray-600">
                    ({selectedExportTeams.length} team{selectedExportTeams.length > 1 ? 's' : ''} selected)
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* HTML Export */}
            <div className="card border-l-4 border-blue-500">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <span className="text-xl">🌐</span> HTML Export
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">
                    Self-contained HTML file viewable offline with sidebar navigation and cross-references.
                  </p>
                </div>
                <button
                  onClick={() => authenticatedDownload(exportHtmlUrl(selectedExportTeams), 'patterns-export.html')}
                  className="btn-primary text-sm ml-3 shrink-0"
                >
                  Export
                </button>
              </div>
            </div>

            {/* PowerPoint Export */}
            <div className="card border-l-4 border-orange-500">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <span className="text-xl">📊</span> PowerPoint Export
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">
                    Presentation deck with framework overview, category deep-dives, and inventory tables.
                  </p>
                </div>
                <button
                  onClick={() => authenticatedDownload(exportPptxUrl(selectedExportTeams), 'patterns-export.pptx')}
                  className="btn-primary text-sm ml-3 shrink-0"
                >
                  Export
                </button>
              </div>
            </div>

            {/* Word Document Export */}
            <div className="card border-l-4 border-cyan-500">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <span className="text-xl">📄</span> Word Document
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">
                    Complete Word document with cover page, TOC, page numbers, and all patterns by category.
                  </p>
                </div>
                <button
                  onClick={() => authenticatedDownload(exportDocxUrl(selectedExportTeams), 'patterns-export.docx')}
                  className="btn-primary text-sm ml-3 shrink-0"
                >
                  Export
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ============ System Status Tab ============ */}
      {tab === 'status' && (
        <div className="space-y-6">
          {loadingStatus ? (
            <div className="text-gray-500 text-center py-12">Loading system status...</div>
          ) : !systemStatus ? (
            <div className="text-gray-500 text-center py-12">Could not load system status</div>
          ) : (
            <>
              {/* Neo4j Connection */}
              <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-3 ${
                systemStatus.neo4j === 'connected'
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-red-500/10 border border-red-500/30'
              }`}>
                <span className={`text-lg ${systemStatus.neo4j === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
                  {systemStatus.neo4j === 'connected' ? '●' : '○'}
                </span>
                <span className={systemStatus.neo4j === 'connected' ? 'text-green-400' : 'text-red-400'}>
                  Neo4j Database: {systemStatus.neo4j === 'connected' ? 'Connected' : 'Disconnected'}
                </span>
                <button onClick={loadSystemStatus} className="ml-auto text-xs text-gray-400 hover:text-white">
                  ↻ Refresh
                </button>
              </div>

              {systemStatus.stats && (
                <>
                  {/* --- Graph Database Report --- */}
                  <div>
                    <h2 className="text-lg font-semibold text-white mb-4">Graph Database</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Patterns */}
                      <div className="card text-center">
                        <div className="text-3xl font-bold text-blue-400">{systemStatus.stats.patterns?.total || 0}</div>
                        <div className="text-xs text-gray-400 mt-1">Patterns</div>
                        <div className="flex justify-center gap-2 mt-2 text-xs">
                          <span className="text-purple-400">{systemStatus.stats.patterns?.ab || 0} AB</span>
                          <span className="text-blue-400">{systemStatus.stats.patterns?.abb || 0} ABB</span>
                          <span className="text-green-400">{systemStatus.stats.patterns?.sbb || 0} SBB</span>
                        </div>
                        {systemStatus.stats.patterns?.deprecated > 0 && (
                          <div className="text-xs text-yellow-500 mt-1">{systemStatus.stats.patterns.deprecated} deprecated</div>
                        )}
                      </div>

                      {/* Technologies */}
                      <div className="card text-center">
                        <div className="text-3xl font-bold text-cyan-400">{systemStatus.stats.technologies?.total || 0}</div>
                        <div className="text-xs text-gray-400 mt-1">Technologies</div>
                        {systemStatus.stats.technologies?.deprecated > 0 && (
                          <div className="text-xs text-yellow-500 mt-2">{systemStatus.stats.technologies.deprecated} deprecated</div>
                        )}
                      </div>

                      {/* PBCs */}
                      <div className="card text-center">
                        <div className="text-3xl font-bold text-purple-400">{systemStatus.stats.pbcs?.total || 0}</div>
                        <div className="text-xs text-gray-400 mt-1">PBCs</div>
                      </div>

                      {/* Categories */}
                      <div className="card text-center">
                        <div className="text-3xl font-bold text-orange-400">{systemStatus.stats.categories?.total || 0}</div>
                        <div className="text-xs text-gray-400 mt-1">Categories</div>
                      </div>
                    </div>

                    {/* Relationships */}
                    {systemStatus.stats.relationships && (
                      <div className="card mt-3">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-gray-400">Relationships</h3>
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                            {systemStatus.stats.relationships.total} total
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(systemStatus.stats.relationships.by_type || {}).map(([type, count]) => (
                            <div key={type} className="flex items-center gap-1.5 bg-gray-800/60 rounded px-2.5 py-1.5 text-xs">
                              <span className="text-gray-400">{type}</span>
                              <span className="font-mono font-semibold text-white">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Indexes */}
                    {systemStatus.stats.indexes && systemStatus.stats.indexes.length > 0 && (
                      <details className="card mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-gray-400 hover:text-white">
                          Database Indexes ({systemStatus.stats.indexes.length})
                        </summary>
                        <div className="mt-3 space-y-1">
                          {systemStatus.stats.indexes.map((idx, i) => (
                            <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-gray-800/50 last:border-0">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${
                                idx.state === 'ONLINE' ? 'bg-green-400' : idx.state === 'POPULATING' ? 'bg-yellow-400' : 'bg-red-400'
                              }`} />
                              <span className="font-mono text-gray-300 min-w-[200px]">{idx.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                idx.type === 'VECTOR' ? 'bg-purple-500/20 text-purple-400' :
                                idx.type === 'RANGE' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-gray-700 text-gray-400'
                              }`}>{idx.type}</span>
                              <span className="text-gray-500">{(idx.labels || []).join(', ')}</span>
                              <span className="text-gray-600">{(idx.properties || []).join(', ')}</span>
                              <span className={`ml-auto text-xs ${idx.state === 'ONLINE' ? 'text-green-400' : 'text-yellow-400'}`}>
                                {idx.state}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>

                  {/* --- Embedding Status --- */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-white">Vector Embeddings</h2>
                      <span className={`text-xs px-2 py-1 rounded ${
                        systemStatus.embedding_available
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {systemStatus.embedding_available
                          ? `● ${(systemStatus.embedding_provider || 'openai').charAt(0).toUpperCase() + (systemStatus.embedding_provider || 'openai').slice(1)} Available`
                          : `○ ${(systemStatus.embedding_provider || 'openai').charAt(0).toUpperCase() + (systemStatus.embedding_provider || 'openai').slice(1)} Unavailable`}
                      </span>
                    </div>

                    {systemStatus.stats.embeddings && (
                      <div className="space-y-3">
                        {Object.entries(systemStatus.stats.embeddings).map(([type, data]) => {
                          const pct = data.total > 0 ? Math.round((data.embedded / data.total) * 100) : 0
                          const typeLabel = type === 'pbcs' ? 'PBCs' : type.charAt(0).toUpperCase() + type.slice(1)
                          return (
                            <div key={type} className="card">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-white">{typeLabel}</span>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-green-400">{data.embedded} embedded</span>
                                  {data.missing > 0 && (
                                    <span className="text-orange-400 font-semibold">{data.missing} missing</span>
                                  )}
                                  <span className="text-gray-500">{data.total} total</span>
                                </div>
                              </div>
                              <div className="w-full bg-gray-800 rounded-full h-2.5">
                                <div
                                  className={`h-2.5 rounded-full transition-all ${
                                    pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-orange-500' : 'bg-gray-700'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="text-right text-xs text-gray-500 mt-1">{pct}%</div>
                            </div>
                          )
                        })}

                        {/* Total summary */}
                        {(() => {
                          const totals = Object.values(systemStatus.stats.embeddings).reduce(
                            (acc, d) => ({ total: acc.total + d.total, embedded: acc.embedded + d.embedded, missing: acc.missing + d.missing }),
                            { total: 0, embedded: 0, missing: 0 }
                          )
                          return (
                            <div className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${
                              totals.missing === 0
                                ? 'bg-green-500/10 border border-green-500/30'
                                : 'bg-orange-500/10 border border-orange-500/30'
                            }`}>
                              <span className={totals.missing === 0 ? 'text-green-400' : 'text-orange-400'}>
                                {totals.missing === 0
                                  ? `✓ All ${totals.total} nodes have embeddings`
                                  : `⚠ ${totals.missing} of ${totals.total} nodes missing embeddings`}
                              </span>
                              <span className="text-xs text-gray-500">
                                {totals.embedded}/{totals.total} embedded
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    {/* Embedding Actions */}
                    <div className="card mt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-400">Embedding Actions</h3>
                        {systemStatus.embedding_model && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-500">Using:</span>
                            <span className="bg-purple-500/15 text-purple-400 px-2 py-0.5 rounded font-mono">
                              {systemStatus.embedding_provider || 'openai'} / {systemStatus.embedding_model}
                            </span>
                            <span className="text-gray-600">{systemStatus.embedding_dimensions}d</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        Embeddings are auto-generated when patterns, technologies, or PBCs are created or updated.
                        Use these buttons for bulk operations or to fix missing embeddings after exceptions or offline work.
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleEmbedMissing}
                          disabled={!!embedding || !systemStatus.embedding_available}
                          className="btn-primary text-sm"
                        >
                          {embedding === 'missing' ? (
                            <span className="flex items-center gap-2">
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                              Embedding...
                            </span>
                          ) : '🔧 Embed Missing Nodes'}
                        </button>
                        <button
                          onClick={handleEmbedAll}
                          disabled={!!embedding || !systemStatus.embedding_available}
                          className="btn-secondary text-sm"
                        >
                          {embedding === 'all' ? (
                            <span className="flex items-center gap-2">
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                              Re-embedding...
                            </span>
                          ) : '🔄 Re-embed All Nodes'}
                        </button>
                      </div>
                      {!systemStatus.embedding_available && (
                        <div className="rounded-lg px-4 py-3 text-xs bg-red-500/5 border border-red-500/20 text-red-300">
                          ⚠ Embedding provider credentials not configured. Set the required API key/credentials in the Configuration tab to enable embeddings.
                          {systemStatus.embedding_provider && (
                            <span className="block mt-1 text-gray-400">
                              Current provider: <strong>{systemStatus.embedding_provider}</strong> / Model: <strong>{systemStatus.embedding_model || 'unknown'}</strong>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Embed Result */}
                      {embedResult && (
                        <div className={`rounded-lg px-4 py-3 text-sm ${
                          embedResult.status === 'ok'
                            ? 'bg-green-500/10 border border-green-500/30'
                            : 'bg-red-500/10 border border-red-500/30'
                        }`}>
                          {embedResult.status === 'ok' ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-green-400">
                                <span>✓</span>
                                <span>
                                  {embedResult.type === 'missing' ? 'Missing embeddings generated' : 'All embeddings regenerated'}
                                </span>
                              </div>
                              {embedResult.embedded && (
                                <div className="flex gap-4 text-xs text-gray-400">
                                  <span>Patterns: {embedResult.embedded.patterns || 0}</span>
                                  <span>Technologies: {embedResult.embedded.technologies || 0}</span>
                                  <span>PBCs: {embedResult.embedded.pbcs || 0}</span>
                                </div>
                              )}
                              {embedResult.provider && (
                                <div className="text-xs text-gray-500">
                                  Provider: {embedResult.provider} / {embedResult.model} ({embedResult.dimensions}d)
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-red-400">
                              <span>✕</span>
                              <span>{embedResult.message || 'Embedding failed'}</span>
                            </div>
                          )}
                          <button
                            onClick={() => setEmbedResult(null)}
                            className="float-right text-gray-500 hover:text-gray-300 -mt-6"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ============ Import & Backup Tab ============ */}
      {tab === 'import' && (
        <div className="space-y-6">

          {/* --- Import Section --- */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Import Data</h2>
              {importStep !== 'upload' && (
                <button onClick={resetImport} className="text-xs text-gray-400 hover:text-white">
                  ← Start Over
                </button>
              )}
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs">
              {['upload', 'preview', 'importing', 'results'].map((step, i) => {
                const labels = ['Upload', 'Preview', 'Importing', 'Results']
                const isCurrent = importStep === step
                const isPast = ['upload', 'preview', 'importing', 'results'].indexOf(importStep) > i
                return (
                  <div key={step} className="flex items-center gap-2">
                    {i > 0 && <div className={`w-8 h-px ${isPast ? 'bg-blue-500' : 'bg-gray-700'}`} />}
                    <span className={`px-2 py-0.5 rounded ${
                      isCurrent ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' :
                      isPast ? 'text-green-400' : 'text-gray-600'
                    }`}>
                      {isPast && !isCurrent ? '✓ ' : ''}{labels[i]}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Step 1: Upload */}
            {importStep === 'upload' && (
              <>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  className="card border-2 border-dashed border-gray-700 hover:border-blue-500/50 transition-colors text-center py-10"
                >
                  <div className="text-4xl mb-3">📁</div>
                  <p className="text-gray-400 text-sm mb-2">
                    Drag & drop a backup file here, or click to browse (.json or .json.gz)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.json.gz,.gz"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="import-file"
                  />
                  <label
                    htmlFor="import-file"
                    className="btn-secondary text-sm cursor-pointer inline-block"
                  >
                    Choose File
                  </label>
                  {importFile && (
                    <div className="mt-3 text-sm text-blue-400">
                      Selected: <span className="font-mono">{importFile.name}</span>
                      <span className="text-gray-500 ml-2">
                        ({(importFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  )}
                </div>

                {importFile && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handlePreview}
                      disabled={previewing}
                      className="btn-primary"
                    >
                      {previewing ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                          Analyzing...
                        </span>
                      ) : 'Preview Changes'}
                    </button>
                    <button
                      onClick={() => { setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="card bg-gray-900/50 text-xs text-gray-500 space-y-2">
                  <p className="font-semibold text-gray-400">Supported formats:</p>
                  <ul className="list-disc list-inside space-y-1 ml-1">
                    <li>Full backup: <code className="text-gray-400">{'{ "patterns": [...], "technologies": [...], "pbcs": [...], "categories": [...] }'}</code></li>
                    <li>Legacy: <code className="text-gray-400">{'[...] (array of patterns only)'}</code></li>
                  </ul>
                  <p className="mt-2 text-yellow-400/70">
                    Note: Existing items with the same ID will be <strong>updated</strong> (not skipped). A backup of your current data is automatically created before import.
                  </p>
                </div>
              </>
            )}

            {/* Step 2: Preview */}
            {importStep === 'preview' && previewData && (
              <div className="space-y-4">
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="card bg-green-500/5 border border-green-500/20 text-center py-3">
                    <div className="text-2xl font-bold text-green-400">{previewData.stats?.total_new || 0}</div>
                    <div className="text-xs text-gray-400 mt-1">New Items</div>
                  </div>
                  <div className="card bg-yellow-500/5 border border-yellow-500/20 text-center py-3">
                    <div className="text-2xl font-bold text-yellow-400">{previewData.stats?.total_updated || 0}</div>
                    <div className="text-xs text-gray-400 mt-1">Will Update</div>
                  </div>
                  <div className="card bg-gray-500/5 border border-gray-500/20 text-center py-3">
                    <div className="text-2xl font-bold text-gray-400">{previewData.stats?.total_unchanged || 0}</div>
                    <div className="text-xs text-gray-400 mt-1">Unchanged</div>
                  </div>
                </div>

                {/* Per-type selectors */}
                <div className="space-y-2">
                  <p className="text-sm text-gray-400 font-medium">Select what to import:</p>
                  {['teams', 'users', 'settings', 'categories', 'patterns', 'technologies', 'pbcs', 'advisor_reports', 'health_analyses'].map(type => {
                    const counts = countPreviewType(type)
                    const total = counts.new + counts.updated + counts.unchanged
                    const TYPE_LABELS = { pbcs: 'PBCs', advisor_reports: 'Advisor Reports', health_analyses: 'Health Analyses', teams: 'Teams', users: 'Users', settings: 'Settings' }
                    const typeLabel = TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1)
                    if (total === 0) return null
                    return (
                      <label
                        key={type}
                        className={`card flex items-center gap-3 cursor-pointer transition-all ${
                          importIncludes[type]
                            ? 'border-blue-500/30 bg-blue-500/5'
                            : 'border-gray-800 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={importIncludes[type]}
                          onChange={e => setImportIncludes(prev => ({ ...prev, [type]: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 bg-gray-800"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">{typeLabel}</div>
                          <div className="text-xs text-gray-500 flex gap-3 mt-0.5">
                            {counts.new > 0 && <span className="text-green-400">{counts.new} new</span>}
                            {counts.updated > 0 && <span className="text-yellow-400">{counts.updated} updated</span>}
                            {counts.unchanged > 0 && <span className="text-gray-500">{counts.unchanged} unchanged</span>}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>

                {/* Expanded details (collapsible) */}
                {['teams', 'users', 'settings', 'patterns', 'technologies', 'pbcs', 'categories', 'advisor_reports', 'health_analyses'].map(type => {
                  const data = previewData[type]
                  if (!data) return null
                  const hasNew = data.new?.length > 0
                  const hasUpdated = data.updated?.length > 0
                  if (!hasNew && !hasUpdated) return null
                  const DETAIL_LABELS = { pbcs: 'PBCs', advisor_reports: 'Advisor Reports', health_analyses: 'Health Analyses', teams: 'Teams', users: 'Users', settings: 'Settings' }
                  const typeLabel = DETAIL_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1)
                  return (
                    <details key={type} className="card border-gray-800">
                      <summary className="cursor-pointer text-sm font-medium text-gray-300 hover:text-white">
                        {typeLabel} details ({(data.new?.length || 0) + (data.updated?.length || 0)} changes)
                      </summary>
                      <div className="mt-3 space-y-2">
                        {hasNew && (
                          <div>
                            <p className="text-xs text-green-400 font-medium mb-1">New ({data.new.length}):</p>
                            <div className="space-y-1">
                              {data.new.map((item, i) => (
                                <div key={i} className="text-xs text-gray-400 font-mono pl-3">
                                  + {item.id || item.code} — {item.name || item.label || ''}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {hasUpdated && (
                          <div>
                            <p className="text-xs text-yellow-400 font-medium mb-1">Updated ({data.updated.length}):</p>
                            <div className="space-y-1">
                              {data.updated.map((item, i) => (
                                <div key={i} className="text-xs text-gray-400 font-mono pl-3">
                                  ~ {item.id || item.code} — {item.name || item.label || ''}
                                  {item.changes && (
                                    <span className="text-gray-600 ml-2">[{item.changes.join(', ')}]</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}

                {/* Auto-backup notice */}
                <div className="rounded-lg px-4 py-3 text-xs bg-blue-500/5 border border-blue-500/20 text-blue-300 flex items-center gap-2">
                  <span>🛡️</span>
                  <span>A backup of your current data will be automatically created before importing.</span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleImport}
                    disabled={importing || !Object.values(importIncludes).some(v => v)}
                    className="btn-primary"
                  >
                    {importing ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                        Importing...
                      </span>
                    ) : 'Confirm Import'}
                  </button>
                  <button onClick={resetImport} className="btn-secondary">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Importing (shown briefly) */}
            {importStep === 'importing' && (
              <div className="card text-center py-10">
                <svg className="animate-spin h-8 w-8 mx-auto text-blue-400 mb-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                <p className="text-gray-400">Importing data...</p>
              </div>
            )}

            {/* Step 4: Results */}
            {importStep === 'results' && importResult && (
              <div className="space-y-4">
                {importResult.error ? (
                  <div className="card bg-red-500/5 border border-red-500/20">
                    <h3 className="text-sm font-semibold text-red-400 mb-2">Import Failed</h3>
                    <p className="text-sm text-red-300">{importResult.error}</p>
                  </div>
                ) : (
                  <div className="card bg-green-500/5 border border-green-500/20">
                    <h3 className="text-sm font-semibold text-green-400 mb-3">Import Completed</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {importResult.teams_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.teams_imported}</div>
                          <div className="text-xs text-gray-400">Teams</div>
                        </div>
                      )}
                      {importResult.users_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.users_imported}</div>
                          <div className="text-xs text-gray-400">Users</div>
                        </div>
                      )}
                      {importResult.settings_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.settings_imported}</div>
                          <div className="text-xs text-gray-400">Settings</div>
                        </div>
                      )}
                      {importResult.patterns_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.patterns_imported}</div>
                          <div className="text-xs text-gray-400">Patterns</div>
                        </div>
                      )}
                      {importResult.owned_by_restored > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.owned_by_restored}</div>
                          <div className="text-xs text-gray-400">Team Ownership</div>
                        </div>
                      )}
                      {importResult.technologies_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.technologies_imported}</div>
                          <div className="text-xs text-gray-400">Technologies</div>
                        </div>
                      )}
                      {importResult.pbcs_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.pbcs_imported}</div>
                          <div className="text-xs text-gray-400">PBCs</div>
                        </div>
                      )}
                      {importResult.categories_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.categories_imported}</div>
                          <div className="text-xs text-gray-400">Categories</div>
                        </div>
                      )}
                      {importResult.relationships_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.relationships_imported}</div>
                          <div className="text-xs text-gray-400">Relationships</div>
                        </div>
                      )}
                      {importResult.advisor_reports_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.advisor_reports_imported}</div>
                          <div className="text-xs text-gray-400">Advisor Reports</div>
                        </div>
                      )}
                      {importResult.health_analyses_imported > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-white">{importResult.health_analyses_imported}</div>
                          <div className="text-xs text-gray-400">Health Analyses</div>
                        </div>
                      )}
                    </div>
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div className="mt-3 border-t border-red-500/20 pt-3">
                        <p className="text-xs text-red-400 font-medium mb-1">Warnings ({importResult.errors.length}):</p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {importResult.errors.map((e, i) => <div key={i} className="text-xs text-red-300/70">⚠ {e}</div>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={resetImport} className="btn-secondary text-sm">
                  Import Another File
                </button>
              </div>
            )}
          </div>

          {/* --- Divider --- */}
          <div className="border-t border-gray-800" />

          {/* --- Backup History Section --- */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Backup History</h2>
            <p className="text-gray-500 text-sm">
              Create, download, and restore server-side backups. Auto-backups are created before every import.
            </p>

            {/* Create backup */}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={backupName}
                onChange={e => setBackupName(e.target.value)}
                placeholder="Optional backup name..."
                className="input flex-1"
              />
              <button
                onClick={handleCreateBackup}
                disabled={creatingBackup}
                className="btn-primary shrink-0"
              >
                {creatingBackup ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                    Creating...
                  </span>
                ) : '💾 Create Backup'}
              </button>
            </div>

            {/* Backup list */}
            {loadingBackups ? (
              <div className="text-gray-500 text-sm text-center py-6">Loading backups...</div>
            ) : backups.length === 0 ? (
              <div className="card text-center py-8 text-gray-600">
                <div className="text-3xl mb-2">📦</div>
                <p className="text-sm">No backups yet. Create one above or import data to trigger an auto-backup.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {backups.map(b => (
                  <div key={b.filename} className={`card flex items-center gap-4 ${
                    b.filename.startsWith('auto_') ? 'border-l-4 border-gray-700' : 'border-l-4 border-blue-500'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">
                          {b.name || b.filename}
                        </span>
                        {b.filename.startsWith('auto_') && (
                          <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded shrink-0">auto</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{formatDate(b.date)}</span>
                        <span>•</span>
                        <span>{formatSize(b.size_bytes)}</span>
                        {b.stats && (
                          <>
                            <span>•</span>
                            <span>
                              {b.stats.patterns || 0}P / {b.stats.technologies || 0}T / {b.stats.pbcs || 0}PBC
                              {(b.stats.teams > 0 || b.stats.users > 0) && ` / ${b.stats.teams || 0}Teams / ${b.stats.users || 0}Users`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => authenticatedDownload(downloadBackupUrl(b.filename), b.filename)}
                        className="px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                        title="Download"
                      >
                        ⬇
                      </button>
                      <button
                        onClick={() => handleRestoreBackup(b.filename)}
                        disabled={restoringBackup === b.filename}
                        className="px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors disabled:opacity-50"
                        title="Restore this backup"
                      >
                        {restoringBackup === b.filename ? '...' : '🔄'}
                      </button>
                      <button
                        onClick={() => handleDeleteBackup(b.filename)}
                        className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ AI Prompts Tab ============ */}
      {tab === 'prompts' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">AI Prompt Editor</h2>
            <p className="text-gray-500 text-xs">
              View, edit, and test all AI prompts. Overrides are stored in the database — reset returns a prompt to its YAML default.
            </p>
          </div>

          {loadingPrompts ? (
            <div className="text-gray-500 text-center py-12">Loading prompts...</div>
          ) : (
            <div className="flex gap-4" style={{ minHeight: '600px' }}>

              {/* --- Left Sidebar: Prompt Tree --- */}
              <div className="w-64 flex-shrink-0 space-y-1">
                <input
                  type="text"
                  placeholder="Filter prompts..."
                  value={promptFilter}
                  onChange={e => setPromptFilter(e.target.value)}
                  className="input w-full text-xs mb-2"
                />
                {promptsData && Object.entries(promptsData.sections || {}).map(([section, sectionData]) => {
                  const prompts = sectionData.prompts || []
                  const filtered = prompts.filter(p =>
                    !promptFilter ||
                    p.section.toLowerCase().includes(promptFilter.toLowerCase()) ||
                    p.sub_prompt.toLowerCase().includes(promptFilter.toLowerCase())
                  )
                  if (!filtered.length) return null
                  return (
                    <div key={section} className="mb-3">
                      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-2 py-1">
                        {sectionData.label || section}
                      </div>
                      {filtered.map(p => {
                        const isActive = selectedPrompt?.section === p.section && selectedPrompt?.sub_prompt === p.sub_prompt
                        return (
                          <button
                            key={`${p.section}.${p.sub_prompt}`}
                            onClick={() => handleSelectPrompt(p.section, p.sub_prompt)}
                            className={`w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                              isActive
                                ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                                : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 border border-transparent'
                            }`}
                          >
                            <span className="truncate flex-1">{p.sub_prompt}</span>
                            {p.is_overridden && (
                              <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded whitespace-nowrap">
                                modified
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* --- Right Panel: Prompt Editor --- */}
              <div className="flex-1 min-w-0">
                {selectedPrompt ? (() => {
                  const currentPrompt = promptsData?.prompts?.find(
                    p => p.section === selectedPrompt.section && p.sub_prompt === selectedPrompt.sub_prompt
                  )
                  if (!currentPrompt) return null
                  return (
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-white font-semibold text-sm">
                            {selectedPrompt.section} <span className="text-gray-600">/</span> {selectedPrompt.sub_prompt}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] text-gray-600">
                              ~{promptDirty ? liveTokenEstimate : currentPrompt.token_estimate} tokens
                            </span>
                            {currentPrompt.is_overridden && (
                              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">
                                Override Active
                              </span>
                            )}
                            {promptDirty && (
                              <span className="text-[10px] text-orange-400">Unsaved changes</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Variables */}
                      {currentPrompt.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-gray-600">Variables:</span>
                          {currentPrompt.variables.map(v => (
                            <span key={v} className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20 font-mono">
                              {'{' + v + '}'}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Textarea Editor */}
                      <textarea
                        value={editValue}
                        onChange={e => { setEditValue(e.target.value); setPromptDirty(true) }}
                        className="input w-full font-mono text-xs leading-relaxed"
                        rows={22}
                        spellCheck={false}
                        style={{ minHeight: '320px', resize: 'vertical' }}
                      />

                      {/* Action Buttons */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleSavePrompt}
                          disabled={savingPrompt || !promptDirty}
                          className="btn-primary text-xs px-4 py-1.5"
                        >
                          {savingPrompt ? 'Saving...' : 'Save Override'}
                        </button>
                        {currentPrompt.is_overridden && (
                          <button
                            onClick={handleResetPrompt}
                            disabled={savingPrompt}
                            className="btn-secondary text-xs px-4 py-1.5"
                          >
                            Reset to Default
                          </button>
                        )}
                        <button
                          onClick={handleTestPrompt}
                          disabled={testingPrompt}
                          className="btn-secondary text-xs px-4 py-1.5"
                        >
                          {testingPrompt ? 'Testing...' : '▶ Test Prompt'}
                        </button>
                        {currentPrompt.is_overridden && (
                          <button
                            onClick={() => {
                              setEditValue(currentPrompt.default_value)
                              setPromptDirty(true)
                            }}
                            className="text-xs text-gray-600 hover:text-gray-400 ml-auto"
                          >
                            View Default
                          </button>
                        )}
                      </div>

                      {/* Test Response */}
                      {testResponse && (
                        <div className={`card border-l-4 ${
                          testResponse.status === 'ok' ? 'border-l-green-500' : 'border-l-red-500'
                        }`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-semibold ${testResponse.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                              {testResponse.status === 'ok' ? '✓ Test Passed' : '✗ Test Failed'}
                            </span>
                            {testResponse.provider && (
                              <span className="text-[10px] text-gray-600">
                                {testResponse.provider} / {testResponse.model}
                              </span>
                            )}
                            {testResponse.latency_ms != null && (
                              <span className="text-[10px] text-gray-600">({testResponse.latency_ms}ms)</span>
                            )}
                          </div>
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-auto max-h-48 font-mono bg-gray-950/50 rounded p-3 border border-gray-800">
                            {testResponse.response}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })() : (
                  <div className="flex items-center justify-center h-full text-gray-600">
                    <div className="text-center">
                      <div className="text-4xl mb-3 opacity-30">📝</div>
                      <p className="text-sm">Select a prompt from the sidebar to view and edit it</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ Advisor Tab ============ */}
      {tab === 'advisor' && (
        <div className="space-y-6">

          {/* --- Section 1: Retention Policy Settings --- */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Retention Policy</h2>
            <p className="text-gray-500 text-xs mb-4">
              Configure automatic cleanup rules for Pattern Advisor reports.
            </p>
          </div>

          <div className="card border-l-4 border-purple-500">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🗂️</span>
              <div>
                <h3 className="font-semibold text-white">Report Retention Rules</h3>
                <span className="text-xs text-gray-500">
                  Starred reports are always preserved regardless of these settings
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max Reports</label>
                <input
                  type="number"
                  value={retentionForm.max_reports}
                  onChange={e => handleRetentionChange('max_reports', e.target.value)}
                  min={1}
                  max={1000}
                  className="input w-full"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Oldest non-starred reports deleted when exceeded
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Retention Days</label>
                <input
                  type="number"
                  value={retentionForm.retention_days}
                  onChange={e => handleRetentionChange('retention_days', e.target.value)}
                  min={1}
                  max={365}
                  className="input w-full"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Reports older than this are eligible for cleanup
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Auto Cleanup</label>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => handleRetentionChange('auto_cleanup', !retentionForm.auto_cleanup)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      retentionForm.auto_cleanup ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      retentionForm.auto_cleanup ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                  <span className="text-sm text-gray-400">
                    {retentionForm.auto_cleanup ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Automatically cleanup after each new analysis
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleSaveRetention}
                disabled={saving || !retentionDirty}
                className="btn-primary text-sm"
              >
                {saving ? 'Saving...' : 'Save Retention Policy'}
              </button>
              {retentionDirty && (
                <span className="text-xs text-yellow-400">Unsaved changes</span>
              )}
            </div>
          </div>

          {/* --- Section 2: Report Management Actions --- */}
          <div className="border-t border-gray-800 pt-6">
            <h2 className="text-lg font-semibold text-white mb-1">Report Management</h2>
            <p className="text-gray-500 text-xs mb-4">
              View statistics and perform bulk operations on advisor reports.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card text-center">
              <div className="text-3xl font-bold text-blue-400">
                {advisorReports.length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Total Reports</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-yellow-400">
                {advisorReports.filter(r => r.starred).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Starred</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-gray-400">
                {advisorReports.filter(r => !r.starred).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Non-Starred</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-purple-400">
                {retentionForm.max_reports}
              </div>
              <div className="text-xs text-gray-400 mt-1">Max Allowed</div>
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-gray-400">Bulk Actions</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={handleAdvisorCleanup}
                className="btn-primary text-sm"
              >
                Run Cleanup
              </button>
              <button
                onClick={handleAdvisorDeleteAll}
                className="btn-danger text-sm"
              >
                Delete All Non-Starred
              </button>
              <button
                onClick={loadAdvisorReports}
                disabled={loadingReports}
                className="btn-secondary text-sm"
              >
                {loadingReports ? '...' : 'Refresh'}
              </button>
            </div>

            {cleanupResult && (
              <div className="rounded-lg px-4 py-3 text-sm bg-green-500/10 border border-green-500/30">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 text-green-400">
                    <div>&#10003; Cleanup completed</div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>Deleted by count: {cleanupResult.deleted_by_count || 0}</span>
                      <span>Deleted by age: {cleanupResult.deleted_by_age || 0}</span>
                      <span>Remaining: {cleanupResult.total_remaining || 0}</span>
                    </div>
                  </div>
                  <button onClick={() => setCleanupResult(null)} className="text-gray-500 hover:text-gray-300">&#x2715;</button>
                </div>
              </div>
            )}
          </div>

          {/* --- Section 3: Report History Table --- */}
          <div className="border-t border-gray-800 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                Report History
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {advisorReports.length}
                </span>
              </h2>
            </div>
          </div>

          {loadingReports ? (
            <div className="text-gray-500 text-sm text-center py-6">Loading reports...</div>
          ) : advisorReports.length === 0 ? (
            <div className="card text-center py-8 text-gray-600">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">No advisor reports yet. Run an analysis in the Pattern Advisor to generate reports.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/80">
                  <tr>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-8">&#9733;</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Title</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-24">ID</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-20">Confidence</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-40">Date</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-32">Provider</th>
                    <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {advisorReports.map(rpt => (
                    <tr key={rpt.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => handleAdvisorToggleStar(rpt.id)}
                          className={`text-lg transition-colors ${
                            rpt.starred
                              ? 'text-yellow-400 hover:text-yellow-300'
                              : 'text-gray-700 hover:text-gray-500'
                          }`}
                        >
                          {rpt.starred ? '\u2605' : '\u2606'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3">
                        {editingReportTitle === rpt.id ? (
                          <input
                            type="text"
                            value={editReportTitleValue}
                            onChange={e => setEditReportTitleValue(e.target.value)}
                            onBlur={() => handleAdvisorRenameReport(rpt.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleAdvisorRenameReport(rpt.id)
                              if (e.key === 'Escape') setEditingReportTitle(null)
                            }}
                            autoFocus
                            className="input text-sm py-0.5 px-1.5 w-full"
                          />
                        ) : (
                          <span
                            className="text-white text-sm cursor-pointer hover:text-blue-300 truncate block"
                            onClick={() => {
                              setEditingReportTitle(rpt.id)
                              setEditReportTitleValue(rpt.title || '')
                            }}
                            title="Click to rename"
                          >
                            {rpt.title || rpt.problem?.slice(0, 60) || 'Untitled'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs font-mono text-blue-400/60">{rpt.id}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        {rpt.confidence && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            CONFIDENCE_COLORS[rpt.confidence] || CONFIDENCE_COLORS.MEDIUM
                          }`}>
                            {rpt.confidence}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">
                        {formatDate(rpt.created_at)}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">
                        {rpt.provider && `${rpt.provider} / ${rpt.model}`}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => authenticatedDownload(advisorReportExportHtmlUrl(rpt.id), `advisor-report-${rpt.id}.html`)}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                            title="Export HTML"
                          >
                            HTML
                          </button>
                          <button
                            onClick={() => authenticatedDownload(advisorReportExportDocxUrl(rpt.id), `advisor-report-${rpt.id}.docx`)}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                            title="Export DOCX"
                          >
                            DOCX
                          </button>
                          <button
                            onClick={() => handleAdvisorDeleteReport(rpt.id)}
                            className="text-xs px-2 py-1 rounded text-red-500/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete report"
                          >
                            &#x2715;
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* Pattern Health is now a separate top-level page at /health */}

      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm Action'}
        message={confirmAction?.message || 'Are you sure?'}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        variant={confirmAction?.variant || 'danger'}
        onConfirm={() => confirmAction?.onConfirm?.()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}

