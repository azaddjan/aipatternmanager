import { useState, useEffect, useRef } from 'react'
import { fetchAdminSettings, updateAdminSettings, setApiKey, exportHtmlUrl, exportPptxUrl, exportDocxUrl, importBackup } from '../api/client'

const PROVIDER_LABELS = {
  anthropic: { label: 'Anthropic (Claude)', icon: '🟣' },
  openai: { label: 'OpenAI', icon: '🟢' },
  ollama: { label: 'Ollama (Local)', icon: '🦙' },
  bedrock: { label: 'AWS Bedrock', icon: '☁️' },
}

const TABS = [
  { key: 'config', label: 'Configuration', icon: '⚙️' },
  { key: 'export', label: 'Export', icon: '📤' },
  { key: 'import', label: 'Import', icon: '📥' },
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

  // Import state
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  const load = () => {
    fetchAdminSettings()
      .then(s => { setSettings(s); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

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

  const handleImport = async () => {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    setMsg('')
    try {
      const result = await importBackup(importFile)
      setImportResult(result)
      setMsg('Import completed successfully')
      setImportFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setMsg(err.message)
      setImportResult({ error: err.message })
    }
    setImporting(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file && file.name.endsWith('.json')) {
      setImportFile(file)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading admin settings...</div>

  const providers = settings?.providers || {}
  const defaultProvider = settings?.default_provider || 'anthropic'

  return (
    <div className="space-y-6">
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
          msg.includes('fail') || msg.includes('error') || msg.includes('Error')
            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
            : 'bg-green-500/10 border border-green-500/30 text-green-400'
        }`}>
          {msg}
          <button onClick={() => setMsg('')} className="float-right text-gray-500 hover:text-gray-300">✕</button>
        </div>
      )}

      {/* ============ Configuration Tab ============ */}
      {tab === 'config' && (
        <div className="space-y-4">
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

                  <div className="flex flex-col gap-2">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefault(name)}
                        disabled={saving}
                        className="btn-secondary text-xs"
                      >
                        Set Default
                      </button>
                    )}
                    <span className={`text-xs text-center ${config.key_set || name === 'ollama' ? 'text-green-400' : 'text-gray-600'}`}>
                      {config.key_set || name === 'ollama' ? '● Ready' : '○ Needs Key'}
                    </span>
                  </div>
                </div>
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
        </div>
      )}

      {/* ============ Export Tab ============ */}
      {tab === 'export' && (
        <div className="space-y-4">
          <p className="text-gray-500 text-sm">
            Export all patterns, technologies, and business capabilities in various formats.
          </p>

          {/* HTML Export */}
          <div className="card border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <span className="text-xl">🌐</span> HTML Export
                </h3>
                <p className="text-gray-500 text-sm mt-1 max-w-md">
                  Self-contained HTML file viewable offline with sidebar navigation, cross-references, and interactive browsing.
                </p>
              </div>
              <button
                onClick={() => window.open(exportHtmlUrl(), '_blank')}
                className="btn-primary text-sm"
              >
                Export HTML
              </button>
            </div>
          </div>

          {/* PowerPoint Export */}
          <div className="card border-l-4 border-orange-500">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <span className="text-xl">📊</span> PowerPoint Export
                </h3>
                <p className="text-gray-500 text-sm mt-1 max-w-md">
                  Presentation deck with intro slides, framework overview, category deep-dives, and pattern inventory tables.
                </p>
              </div>
              <button
                onClick={() => window.open(exportPptxUrl(), '_blank')}
                className="btn-primary text-sm"
              >
                Export PPTX
              </button>
            </div>
          </div>

          {/* Word Document Export */}
          <div className="card border-l-4 border-cyan-500">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <span className="text-xl">📄</span> Word Document Export
                </h3>
                <p className="text-gray-500 text-sm mt-1 max-w-md">
                  Complete Word document with cover page, table of contents, page numbers, and all patterns grouped by category.
                </p>
              </div>
              <button
                onClick={() => window.open(exportDocxUrl(), '_blank')}
                className="btn-primary text-sm"
              >
                Export DOCX
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Import Tab ============ */}
      {tab === 'import' && (
        <div className="space-y-4">
          <p className="text-gray-500 text-sm">
            Import patterns, technologies, and business capabilities from a JSON backup file.
          </p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="card border-2 border-dashed border-gray-700 hover:border-blue-500/50 transition-colors text-center py-10"
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="text-gray-400 text-sm mb-2">
              Drag & drop a JSON backup file here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={e => setImportFile(e.target.files?.[0] || null)}
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
                onClick={handleImport}
                disabled={importing}
                className="btn-primary"
              >
                {importing ? 'Importing...' : 'Import Backup'}
              </button>
              <button
                onClick={() => { setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          )}

          {importResult && !importResult.error && (
            <div className="card bg-green-500/5 border border-green-500/20">
              <h3 className="text-sm font-semibold text-green-400 mb-2">Import Results</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {importResult.patterns_created != null && (
                  <div className="text-gray-400">Patterns created: <span className="text-white">{importResult.patterns_created}</span></div>
                )}
                {importResult.technologies_created != null && (
                  <div className="text-gray-400">Technologies created: <span className="text-white">{importResult.technologies_created}</span></div>
                )}
                {importResult.pbcs_created != null && (
                  <div className="text-gray-400">PBCs created: <span className="text-white">{importResult.pbcs_created}</span></div>
                )}
                {importResult.relationships_created != null && (
                  <div className="text-gray-400">Relationships created: <span className="text-white">{importResult.relationships_created}</span></div>
                )}
                {importResult.skipped != null && importResult.skipped > 0 && (
                  <div className="text-gray-400">Skipped (existing): <span className="text-yellow-400">{importResult.skipped}</span></div>
                )}
              </div>
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-400">
                  {importResult.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
            </div>
          )}

          <div className="card bg-gray-900/50 text-xs text-gray-500 space-y-2">
            <p className="font-semibold text-gray-400">Expected JSON format:</p>
            <pre className="text-xs font-mono text-gray-500 bg-gray-900 rounded p-3 overflow-x-auto">
{`{
  "patterns": [...],
  "technologies": [...],
  "pbcs": [...],
  "relationships": [
    { "source_id": "...", "target_id": "...", "type": "IMPLEMENTS" }
  ]
}`}
            </pre>
            <p>Existing items with the same ID will be skipped (not overwritten).</p>
          </div>
        </div>
      )}
    </div>
  )
}
