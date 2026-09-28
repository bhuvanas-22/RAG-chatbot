import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle, Download, Menu, Sparkles, Trash2
} from 'lucide-react'
import {
  ApiError, chatStream, checkKey, clearDocuments, deleteDocument,
  listDocuments, previewDocument, uploadDocument
} from './api'
import {
  ChatWindow, Composer, DocumentDrawer, SettingsModal, Sidebar
} from './components'
import type {
  ChatSession, DocumentItem, DocumentPreviewData, HistoryItem, Message,
  Persona, Source, Theme, UploadItem
} from './types'
import './App.css'

const MAX_FILE_SIZE = 25 * 1024 * 1024
const newId = () => crypto.randomUUID()

function createDefaultSession(): ChatSession {
  const id = newId()
  return {
    id,
    title: 'New Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    persona: 'standard',
  }
}

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '')
  const [model, setModel] = useState(() => localStorage.getItem('gemini_model') || 'gemini-3.8-flash')
  const [serverKey, setServerKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    JSON.parse(localStorage.getItem('included_documents') || '{}') as Record<string, boolean>
  )

  // Multi-session chat management
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('rag_sessions') || localStorage.getItem('atlas_sessions')
      if (saved) {
        const parsed = JSON.parse(saved) as ChatSession[]
        if (parsed.length > 0) return parsed
      }
    } catch {
      // ignore
    }
    return [createDefaultSession()]
  })

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => sessions[0]?.id || '')

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === currentSessionId) || sessions[0] || createDefaultSession()
  }, [sessions, currentSessionId])

  const messages = currentSession.messages
  const persona = currentSession.persona || 'standard'

  const [input, setInput] = useState('')
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'dark')
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })
  const [loadError, setLoadError] = useState('')

  // Document Inspector Drawer state
  const [drawerData, setDrawerData] = useState<DocumentPreviewData | null>(null)
  const [highlightedChunk, setHighlightedChunk] = useState<number | undefined>(undefined)

  const hasKey = serverKey || apiKey.trim().length > 0
  const readyDocuments = useMemo(() => {
    return documents.filter((doc) => included[doc.name] !== false)
  }, [documents, included])

  const canChat = hasKey && readyDocuments.length > 0

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('included_documents', JSON.stringify(included))
  }, [included])

  useEffect(() => {
    localStorage.setItem('rag_sessions', JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    void refresh()
  }, [])

  // Keyboard shortcuts: Ctrl+K for new chat, Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        startNewSession()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sessions])

  async function refresh() {
    try {
      setLoadError('')
      const [keyResult, documentResult] = await Promise.all([checkKey(), listDocuments()])
      setServerKey(keyResult.configured)
      if (keyResult.default_model && !localStorage.getItem('gemini_model')) {
        setModel(keyResult.default_model)
      }
      if (keyResult.available_models) {
        setAvailableModels(keyResult.available_models)
      }
      setDocuments(documentResult)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not reach backend.')
    }
  }

  function updateCurrentSession(updater: (session: ChatSession) => ChatSession) {
    setSessions((prev) =>
      prev.map((s) => (s.id === currentSession.id ? updater(s) : s))
    )
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', String(next))
      return next
    })
  }

  function startNewSession() {
    const fresh = createDefaultSession()
    setSessions((prev) => [fresh, ...prev])
    setCurrentSessionId(fresh.id)
    setMobileSidebar(false)
  }

  function deleteSession(id: string) {
    if (sessions.length <= 1) {
      const fresh = createDefaultSession()
      setSessions([fresh])
      setCurrentSessionId(fresh.id)
      return
    }
    const filtered = sessions.filter((s) => s.id !== id)
    setSessions(filtered)
    if (currentSessionId === id) {
      setCurrentSessionId(filtered[0].id)
    }
  }

  function setPersona(p: Persona) {
    updateCurrentSession((s) => ({ ...s, persona: p }))
  }

  function openSettings(message = '') {
    setSettingsStatus(message)
    setSettingsOpen(true)
  }

  function saveSettings(key: string, selectedModel: string) {
    setApiKey(key)
    setModel(selectedModel)
    localStorage.setItem('gemini_api_key', key)
    localStorage.setItem('gemini_model', selectedModel)
    setSettingsStatus('Settings saved.')
    setTimeout(() => setSettingsOpen(false), 600)
  }

  async function testConnection(key: string) {
    setSettingsStatus('Testing connection...')
    try {
      const result = await checkKey()
      if (result.configured || key.trim()) {
        setSettingsStatus('Connected. Gemini is ready.')
      } else {
        setSettingsStatus('No API key detected.')
      }
    } catch {
      setSettingsStatus('Backend connection failed. Ensure server is running.')
    }
  }

  function validateFile(file: File) {
    const ext = file.name.toLowerCase().split('.').pop() || ''
    const allowed = ['pdf', 'docx', 'doc', 'csv', 'txt', 'md', 'json', 'py', 'ts', 'js', 'html', 'css']
    if (!allowed.includes(ext)) {
      return `File type .${ext} is not supported. Upload PDF, DOCX, CSV, TXT, MD or Code.`
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File is larger than ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
    }
    return ''
  }

  async function handleFiles(files: File[]) {
    if (!hasKey) {
      openSettings('Configure a Gemini API Key before uploading documents.')
      return
    }

    for (const file of files) {
      const err = validateFile(file)
      const id = newId()
      if (err) {
        setUploads((prev) => [...prev, { id, file, status: 'failed', progress: 0, error: err }])
        continue
      }

      setUploads((prev) => [...prev, { id, file, status: 'uploading', progress: 30 }])
      try {
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: 'processing', progress: 65 } : u))
        )
        await uploadDocument(file, apiKey)
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: 'ready', progress: 100 } : u))
        )
        await refresh()
      } catch (uploadError) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, status: 'failed', progress: 0, error: getErrorMessage(uploadError) } : u
          )
        )
      }
    }
  }

  async function removeDocument(name: string) {
    if (!window.confirm(`Delete "${name}" from the knowledge base?`)) return
    try {
      await deleteDocument(name, apiKey)
      await refresh()
    } catch (err) {
      alert(getErrorMessage(err))
    }
  }

  async function clearKnowledgeBase() {
    if (!window.confirm('Clear every document from the local ChromaDB store?')) return
    try {
      await clearDocuments(apiKey)
      await refresh()
    } catch (err) {
      alert(getErrorMessage(err))
    }
  }

  function toggleDocument(name: string) {
    setIncluded((prev) => ({ ...prev, [name]: prev[name] === false }))
  }

  async function openDocumentPreview(name: string, targetChunkIndex?: number) {
    try {
      const preview = await previewDocument(name)
      setDrawerData(preview)
      setHighlightedChunk(targetChunkIndex)
    } catch (err) {
      alert(`Could not load document preview: ${getErrorMessage(err)}`)
    }
  }

  async function handleInspectSource(source: Source) {
    await openDocumentPreview(source.doc_name)
  }

  async function submitMessage(event?: FormEvent, forcedText?: string) {
    event?.preventDefault()
    const text = (forcedText || input).trim()
    if (!text || !canChat || generating) return

    setInput('')
    const userMsgId = newId()
    const assistantMsgId = newId()

    // Title generation on first user prompt
    const isFirst = messages.length === 0
    const newTitle = isFirst ? (text.length > 32 ? text.slice(0, 32) + '...' : text) : currentSession.title

    // Add user message & placeholder streaming assistant message
    const userMessage: Message = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }

    const assistantPlaceholder: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      searchStep: 'Searching knowledge base...',
      sources: [],
      timestamp: new Date().toISOString(),
    }

    updateCurrentSession((s) => ({
      ...s,
      title: newTitle,
      messages: [...s.messages, userMessage, assistantPlaceholder],
      updatedAt: new Date().toISOString(),
    }))

    setGenerating(true)
    const controller = new AbortController()
    setAbortController(controller)

    // Build chat history for LLM
    const historyPayload: HistoryItem[] = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      content: m.content,
    }))

    const selectedDocFilter = readyDocuments.length === documents.length
      ? undefined
      : readyDocuments.map((d) => d.name)

    let streamedContent = ''
    let collectedSources: Source[] = []

    try {
      await chatStream(
        text,
        historyPayload,
        apiKey,
        {
          onStatus: (_step, statusMsg) => {
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, searchStep: statusMsg } : m
              ),
            }))
          },
          onSources: (srcs) => {
            collectedSources = srcs
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, sources: srcs } : m
              ),
            }))
          },
          onDelta: (delta) => {
            streamedContent += delta
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, content: streamedContent } : m
              ),
            }))
          },
          onSuggestions: (suggestions) => {
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, follow_ups: suggestions } : m
              ),
            }))
          },
          onDone: (finalReply, finalSources) => {
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: finalReply || streamedContent,
                      sources: finalSources || collectedSources,
                      status: 'ready',
                      searchStep: undefined,
                    }
                  : m
              ),
            }))
          },
          onError: (errMsg) => {
            updateCurrentSession((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: errMsg, status: 'error', searchStep: undefined }
                  : m
              ),
            }))
          },
        },
        persona,
        selectedDocFilter,
        model,
        controller.signal
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        const errorText = getErrorMessage(err)
        updateCurrentSession((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: errorText, status: 'error', searchStep: undefined }
              : m
          ),
        }))
      }
    } finally {
      setGenerating(false)
      setAbortController(null)
    }
  }

  function stopGenerating() {
    abortController?.abort()
    setGenerating(false)
    setAbortController(null)
    // finalize message
    updateCurrentSession((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.status === 'streaming' ? { ...m, status: 'ready', searchStep: undefined } : m
      ),
    }))
  }

  function clearActiveChat() {
    if (!messages.length || window.confirm('Clear messages in this conversation?')) {
      updateCurrentSession((s) => ({ ...s, messages: [], updatedAt: new Date().toISOString() }))
    }
  }

  function regenerate(index: number) {
    const prevMsg = messages[index - 1]
    if (prevMsg?.role === 'user') {
      void submitMessage(undefined, prevMsg.content)
    }
  }

  function copyText(val: string) {
    void navigator.clipboard?.writeText(val)
  }

  function exportChat() {
    if (messages.length === 0) return
    let md = `# ${currentSession.title}\n*Exported from RAG - Chatbot on ${new Date().toLocaleString()}*\n\n---\n\n`
    for (const m of messages) {
      md += `### ${m.role === 'user' ? 'User' : 'RAG - Chatbot'}\n\n${m.content}\n\n`
      if (m.sources && m.sources.length > 0) {
        md += `**Sources cited:**\n`
        m.sources.forEach((s, idx) => {
          md += `- [${idx + 1}] ${s.doc_name} (Match: ${Math.round(s.score * 100)}%)\n`
        })
        md += '\n'
      }
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentSession.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <Sidebar
        open={mobileSidebar}
        collapsed={sidebarCollapsed}
        onClose={() => setMobileSidebar(false)}
        onToggleCollapse={toggleSidebar}
        documents={documents}
        included={included}
        onToggle={toggleDocument}
        onDelete={(name) => void removeDocument(name)}
        onClear={() => void clearKnowledgeBase()}
        canUpload={hasKey}
        onSettings={() => openSettings()}
        theme={theme}
        onTheme={() => setTheme((curr) => (curr === 'dark' ? 'light' : 'dark'))}
        sessions={sessions}
        currentSessionId={currentSession.id}
        onSelectSession={(id) => {
          setCurrentSessionId(id)
          setMobileSidebar(false)
        }}
        onNewSession={startNewSession}
        onDeleteSession={deleteSession}
        onPreviewDocument={(name) => void openDocumentPreview(name)}
      />

      {mobileSidebar && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className={`icon-button sidebar-toggle-btn ${sidebarCollapsed ? 'visible' : ''}`}
              onClick={() => {
                if (window.innerWidth <= 768) {
                  setMobileSidebar(true)
                } else {
                  setSidebarCollapsed(false)
                }
              }}
              title={sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Open navigation'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Open navigation'}
            >
              <Menu size={18} />
            </button>
            <div className="topbar-session-title">
              <div className="title-row">
                <h2>{currentSession.title}</h2>
                <span className="count-pill">
                  {readyDocuments.length} of {documents.length} files active
                </span>
              </div>
              <p>Grounded Retrieval-Augmented Generation</p>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="model-chip" title="Active Model">
              <Sparkles size={13} /> {model}
            </span>

            {messages.length > 0 && (
              <>
                <button
                  className="icon-button"
                  onClick={exportChat}
                  title="Export chat as Markdown"
                  aria-label="Export chat"
                >
                  <Download size={15} />
                </button>
                <button
                  className="icon-button"
                  onClick={clearActiveChat}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </header>

        {loadError && (
          <div className="error-banner">
            <AlertCircle size={15} />
            <span>{loadError}</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}

        <ChatWindow
          messages={messages}
          documentsReady={canChat}
          onSuggestion={(prompt) => void submitMessage(undefined, prompt)}
          onCopy={copyText}
          onRegenerate={regenerate}
          onInspectSource={handleInspectSource}
        />

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={(e) => void submitMessage(e)}
          disabled={!canChat}
          canUpload={hasKey}
          documentsReady={canChat}
          generating={generating}
          onStop={stopGenerating}
          onFiles={(files) => void handleFiles(files)}
          uploads={uploads}
          persona={persona}
          onPersonaChange={setPersona}
        />
      </main>

      <DocumentDrawer
        data={drawerData}
        highlightedChunkIndex={highlightedChunk}
        onClose={() => setDrawerData(null)}
      />

      <SettingsModal
        open={settingsOpen}
        apiKey={apiKey}
        model={model}
        availableModels={availableModels}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onTest={(key) => void testConnection(key)}
        testStatus={settingsStatus}
      />
    </div>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429) {
    return 'Gemini API quota rate-limited. Please wait a few seconds and retry.'
  }
  if (error instanceof ApiError && error.status === 401) {
    return 'Your Gemini API key is missing or invalid. Please check Workspace Settings.'
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

export default App
