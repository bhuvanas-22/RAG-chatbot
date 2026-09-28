import { useState, useRef, useEffect, useMemo } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle, Archive, BookOpen, Brain, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp,
  Copy, Database, ExternalLink, Eye, EyeOff, File, FileCode2,
  FileSpreadsheet, FileText, KeyRound, LoaderCircle, Menu, Mic, MicOff,
  Moon, Paperclip, Plus, RefreshCw, Search, Send, Settings, ShieldCheck,
  Sparkles, Square, Sun, ThumbsDown, ThumbsUp, Trash2,
  Volume2, VolumeX, X, Layers, MessageSquare, History, Wand2
} from 'lucide-react'
import Markdown from 'react-markdown'
import type { ChatSession, DocumentItem, DocumentPreviewData, Message, Persona, Source, Theme, UploadItem } from './types'

const getFileIcon = (name: string) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return <FileText className="file-icon-pdf" size={16} />
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx')) return <FileSpreadsheet className="file-icon-csv" size={16} />
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return <FileText className="file-icon-doc" size={16} />
  if (lower.endsWith('.md') || lower.endsWith('.py') || lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.json')) {
    return <FileCode2 className="file-icon-code" size={16} />
  }
  return <File className="file-icon-general" size={16} />
}

export function Brand({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <div className="brand">
      <button
        className="icon-button sidebar-toggle-btn"
        onClick={onToggleSidebar}
        aria-label="Collapse sidebar"
        title="Collapse sidebar (Ctrl+B)"
      >
        <Menu size={18} />
      </button>
      <div className="brand-badge">
        <Sparkles size={16} />
      </div>
      <div className="brand-text">
        <strong>RAG - Chatbot</strong>
        <span>Intelligence Engine</span>
      </div>
    </div>
  )
}

export function Sidebar({
  open,
  collapsed = false,
  onClose,
  onToggleCollapse,
  documents,
  included,
  onToggle,
  onDelete,
  onClear,
  canUpload,
  onSettings,
  theme,
  onTheme,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onPreviewDocument,
}: {
  open: boolean
  collapsed?: boolean
  onClose: () => void
  onToggleCollapse?: () => void
  documents: DocumentItem[]
  included: Record<string, boolean>
  onToggle: (name: string) => void
  onDelete: (name: string) => void
  onClear: () => void
  canUpload: boolean
  onSettings: () => void
  theme: Theme
  onTheme: () => void
  sessions: ChatSession[]
  currentSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onPreviewDocument: (name: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'chats' | 'docs'>('docs')

  const handleToggle = () => {
    if (window.innerWidth <= 768) {
      onClose()
    } else {
      onToggleCollapse?.()
    }
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <Brand onToggleSidebar={handleToggle} />
        <button className="icon-button close-mobile" onClick={onClose} aria-label="Close navigation">
          <X size={17} />
        </button>
      </div>

      <button className="new-chat-btn" onClick={onNewSession}>
        <Plus size={16} />
        <span>New Chat</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="sidebar-tab-pills">
        <button
          className={`tab-pill ${activeTab === 'docs' ? 'active' : ''}`}
          onClick={() => setActiveTab('docs')}
        >
          <Database size={13} />
          <span>Knowledge ({documents.length})</span>
        </button>
        <button
          className={`tab-pill ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          <History size={13} />
          <span>History ({sessions.length})</span>
        </button>
      </div>

      <div className="sidebar-body">
        {activeTab === 'docs' ? (
          <DocumentList
            documents={documents}
            included={included}
            onToggle={onToggle}
            onDelete={onDelete}
            onClear={onClear}
            onPreview={onPreviewDocument}
          />
        ) : (
          <ChatHistoryList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
          />
        )}
      </div>

      <div className="sidebar-footer">
        <div className="connection-card">
          <div className="connection-info">
            <span className={`connection-dot ${canUpload ? 'online' : 'offline'}`} />
            <div className="connection-labels">
              <strong>{canUpload ? 'Gemini 3.8 Flash' : 'Key Required'}</strong>
              <small>{canUpload ? 'Neural Grounding Active' : 'Configure in Settings'}</small>
            </div>
          </div>
          <div className="footer-actions">
            <button className="icon-button" onClick={onTheme} aria-label="Toggle theme" title="Toggle theme">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="icon-button" onClick={onSettings} aria-label="Open settings" title="Open settings">
              <Settings size={15} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function ChatHistoryList({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
}: {
  sessions: ChatSession[]
  currentSessionId: string
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <div className="sidebar-empty">
        <MessageSquare size={18} />
        <span>No past conversations</span>
      </div>
    )
  }

  return (
    <div className="history-list">
      {sessions.map((session) => {
        const isCurrent = session.id === currentSessionId
        return (
          <div
            key={session.id}
            className={`history-row ${isCurrent ? 'active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <MessageSquare size={14} className="history-icon" />
            <div className="history-meta">
              <strong title={session.title}>{session.title}</strong>
              <small>{formatDate(session.updatedAt)}</small>
            </div>
            <button
              className="icon-button history-del"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteSession(session.id)
              }}
              title="Delete chat"
              aria-label="Delete chat"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function DocumentList({
  documents,
  included,
  onToggle,
  onDelete,
  onClear,
  onPreview,
}: {
  documents: DocumentItem[]
  included: Record<string, boolean>
  onToggle: (name: string) => void
  onDelete: (name: string) => void
  onClear: () => void
  onPreview: (name: string) => void
}) {
  return (
    <section className="document-section">
      <div className="section-heading">
        <div className="eyebrow">
          <Database size={13} /> Grounded Files
        </div>
        {documents.length > 0 && (
          <button className="text-button danger" onClick={onClear} title="Clear all indexed documents">
            Clear all
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="sidebar-empty">
          <Archive size={18} />
          <span>No documents loaded</span>
          <small>Drop PDF, DOCX, CSV, or TXT into the chat below</small>
        </div>
      ) : (
        <div className="document-list">
          {documents.map((doc) => {
            const isIncluded = included[doc.name] !== false
            return (
              <div key={doc.name} className={`document-row ${isIncluded ? '' : 'excluded'}`}>
                <span className="file-icon-wrap">{getFileIcon(doc.name)}</span>
                <div className="document-meta" onClick={() => onPreview(doc.name)} title="Click to view chunks">
                  <strong title={doc.name}>{doc.name}</strong>
                  <div className="document-sub">
                    <span className="chunk-badge">{doc.chunks_count} chunks</span>
                    {doc.pages_count && doc.pages_count > 1 && (
                      <span className="page-badge">{doc.pages_count} pgs</span>
                    )}
                  </div>
                </div>

                <div className="row-actions">
                  <button
                    className="icon-button preview-btn"
                    aria-label={`Preview ${doc.name}`}
                    title="Inspect document chunks"
                    onClick={() => onPreview(doc.name)}
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    className="icon-button check-btn"
                    aria-label={`Toggle ${doc.name}`}
                    title={isIncluded ? 'Included in search' : 'Excluded from search'}
                    onClick={() => onToggle(doc.name)}
                  >
                    <Check size={13} className={isIncluded ? 'active-check' : 'muted-icon'} />
                  </button>
                  <button
                    className="icon-button danger-icon"
                    aria-label={`Delete ${doc.name}`}
                    title="Delete document"
                    onClick={() => onDelete(doc.name)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function ChatWindow({
  messages,
  documentsReady,
  onSuggestion,
  onCopy,
  onRegenerate,
  onInspectSource,
}: {
  messages: Message[]
  documentsReady: boolean
  onSuggestion: (value: string) => void
  onCopy: (value: string) => void
  onRegenerate: (index: number) => void
  onInspectSource: (source: Source) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="chat-scroll">
      <div className="chat-column">
        {messages.length === 0 ? (
          <EmptyState documentsReady={documentsReady} onSuggestion={onSuggestion} />
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              index={index}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onInspectSource={onInspectSource}
              onSuggestion={onSuggestion}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function EmptyState({
  documentsReady,
  onSuggestion,
}: {
  documentsReady: boolean
  onSuggestion: (value: string) => void
}) {
  const suggestions = [
    { title: 'Executive Summary', prompt: 'Give me an executive summary of the uploaded documents with key findings.', icon: '📊' },
    { title: 'Key Data & Metrics', prompt: 'What are the most important statistics, numbers, and dates mentioned?', icon: '🔢' },
    { title: 'Risk & Strategy Analysis', prompt: 'Identify the main challenges, risks, or strategic recommendations.', icon: '⚡' },
    { title: 'Table Extraction', prompt: 'Extract any tables or structured comparisons into a neat Markdown table.', icon: '📑' },
  ]

  return (
    <div className="empty-chat-container">
      <div className="empty-chat-hero">
        <div className="hero-glow" />
        <div className="hero-icon-box">
          <Sparkles size={24} />
        </div>
        <h2>{documentsReady ? 'What would you like to explore?' : 'Upload your documents to begin'}</h2>
        <p>
          {documentsReady
            ? 'Ask questions grounded strictly in your files. Sources, page references, and similarity match percentages are provided in real-time.'
            : 'Drop PDF, Word (.docx), CSV spreadsheets, Markdown, or Code files into the composer below. Real-time RAG intelligence will unlock instantly.'}
        </p>
      </div>

      {documentsReady && (
        <div className="suggested-grid">
          {suggestions.map((s) => (
            <button key={s.title} className="suggested-card" onClick={() => onSuggestion(s.prompt)}>
              <span className="card-emoji">{s.icon}</span>
              <div className="card-text">
                <strong>{s.title}</strong>
                <p>{s.prompt}</p>
              </div>
              <ChevronRight size={15} className="card-arrow" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  index,
  onCopy,
  onRegenerate,
  onInspectSource,
  onSuggestion,
}: {
  message: Message
  index: number
  onCopy: (value: string) => void
  onRegenerate: (index: number) => void
  onInspectSource: (source: Source) => void
  onSuggestion: (value: string) => void
}) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSources, setShowSources] = useState(false)

  const handleCopy = () => {
    onCopy(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const toggleSpeech = () => {
    if (!('speechSynthesis' in window)) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    } else {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(message.content)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utterance)
      setSpeaking(true)
    }
  }

  const docNames = useMemo(() => {
    if (!message.sources || message.sources.length === 0) return []
    return Array.from(new Set(message.sources.map((s) => s.doc_name)))
  }, [message.sources])

  const docNamesSummary = useMemo(() => {
    if (docNames.length === 0) return 'documents'
    if (docNames.length === 1) return docNames[0]
    return `${docNames[0]} and ${docNames.length - 1} other${docNames.length > 2 ? 's' : ''}`
  }, [docNames])

  const highestScore = useMemo(() => {
    if (!message.sources || message.sources.length === 0) return 0
    return Math.round(Math.max(...message.sources.map((s) => s.score)) * 100)
  }, [message.sources])

  return (
    <article className={`message message-${message.role}`}>
      <div className="avatar">
        {message.role === 'assistant' ? <Sparkles size={14} /> : 'You'}
      </div>

      <div className="message-body">
        <div className="message-topline">
          <div className="topline-sender">
            <span>{message.role === 'assistant' ? 'RAG - Chatbot' : 'You'}</span>
            {message.status === 'streaming' && (
              <span className="streaming-badge">
                <LoaderCircle size={11} className="spin" /> Generating...
              </span>
            )}
          </div>

          <div className="message-actions">
            <button onClick={handleCopy} title="Copy response">
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
            {message.role === 'assistant' && (
              <>
                <button onClick={toggleSpeech} title={speaking ? 'Stop speaking' : 'Read aloud'}>
                  {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button onClick={() => onRegenerate(index)} title="Regenerate answer">
                  <RefreshCw size={13} />
                </button>
                <button
                  className={feedback === 'up' ? 'selected' : ''}
                  onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
                  title="Helpful"
                >
                  <ThumbsUp size={13} />
                </button>
                <button
                  className={feedback === 'down' ? 'selected' : ''}
                  onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
                  title="Not helpful"
                >
                  <ThumbsDown size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Modern AI Reasoning & Knowledge Extraction Component */}
        {message.role === 'assistant' && (message.status === 'streaming' || (message.sources && message.sources.length > 0)) && (
          <div className={`thought-container ${message.status === 'streaming' ? 'is-streaming' : 'is-ready'}`}>
            {message.status === 'streaming' ? (
              <div className="thought-streaming-card">
                <div className="thought-stream-header">
                  <div className="thought-stream-title">
                    <Brain size={15} className="spin-slow text-accent" />
                    <span>Thinking & Extracting Knowledge...</span>
                  </div>
                  <span className="live-pulse-badge">Live Analysis</span>
                </div>
                <div className="thought-stream-steps">
                  <div className={`stream-step ${message.searchStage === 'retrieving' ? 'current' : 'completed'}`}>
                    <span className="step-bullet" />
                    <span className="step-text">Searching indexed documents for conceptual matches...</span>
                  </div>
                  <div className={`stream-step ${message.searchStage === 'analyzing' ? 'current' : message.searchStage === 'generating' || message.searchStage === 'done' ? 'completed' : 'waiting'}`}>
                    <span className="step-bullet" />
                    <span className="step-text">
                      {message.sources && message.sources.length > 0
                        ? `Analyzed ${message.sources.length} relevant excerpts from ${docNamesSummary}`
                        : 'Analyzing & scoring relevance across passages...'}
                    </span>
                  </div>
                  <div className={`stream-step ${message.searchStage === 'generating' ? 'current' : message.searchStage === 'done' ? 'completed' : 'waiting'}`}>
                    <span className="step-bullet" />
                    <span className="step-text">Extracting verified facts and synthesizing grounded answer...</span>
                  </div>
                </div>
              </div>
            ) : message.sources && message.sources.length > 0 ? (
              <div className="thought-accordion">
                <button
                  type="button"
                  className="thought-accordion-btn"
                  onClick={() => setShowSources((prev) => !prev)}
                  aria-expanded={showSources}
                >
                  <div className="thought-btn-left">
                    <Brain size={14} className="text-accent" />
                    <span className="thought-btn-title">
                      Thought Process · Analyzed {message.sources.length} excerpt{message.sources.length > 1 ? 's' : ''} from {docNamesSummary}
                    </span>
                  </div>
                  <div className="thought-btn-right">
                    <span className="thought-verified-badge">{highestScore}% relevance</span>
                    <ChevronDown size={14} className={`chevron-rot ${showSources ? 'open' : ''}`} />
                  </div>
                </button>

                {showSources && (
                  <div className="thought-accordion-body">
                    <div className="thought-pipeline-flow">
                      <div className="pipeline-step">
                        <div className="pipeline-step-head">
                          <Search size={13} className="text-accent" />
                          <strong>1. Knowledge Search</strong>
                        </div>
                        <p>Scanned ChromaDB vector store and retrieved top {message.sources.length} candidates</p>
                      </div>
                      <div className="pipeline-step">
                        <div className="pipeline-step-head">
                          <Layers size={13} className="text-accent" />
                          <strong>2. Passage Analysis</strong>
                        </div>
                        <p>Ranked passages with match scores up to {highestScore}% in {docNamesSummary}</p>
                      </div>
                      <div className="pipeline-step">
                        <div className="pipeline-step-head">
                          <Sparkles size={13} className="text-accent" />
                          <strong>3. Grounded Extraction</strong>
                        </div>
                        <p>Extracted verified context to formulate accurate, hallucination-free response</p>
                      </div>
                    </div>

                    <div className="thought-passages-list">
                      <div className="passages-list-title">Extracted Grounding Context ({message.sources.length})</div>
                      {message.sources.map((src, sIdx) => {
                        const pageLabel = src.page_number && src.page_number > 1 ? ` · Page ${src.page_number}` : ''
                        return (
                          <div className="thought-passage-card" key={`src-${sIdx}`}>
                            <div className="passage-card-top">
                              <div className="passage-doc-meta">
                                <span className="passage-index">[{sIdx + 1}]</span>
                                <strong title={src.doc_name}>{src.doc_name}</strong>
                                {pageLabel && <span className="badge-page">{pageLabel}</span>}
                              </div>
                              <span className="passage-match-score">{Math.round(src.score * 100)}% Match</span>
                            </div>
                            <blockquote className="passage-quote-text">
                              "{src.text.length > 250 ? src.text.slice(0, 250) + '...' : src.text}"
                            </blockquote>
                            <button
                              type="button"
                              className="passage-inspect-action"
                              onClick={() => onInspectSource(src)}
                            >
                              <ExternalLink size={11} /> Inspect in Document Viewer
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        <div className={`message-content ${message.status === 'error' ? 'error-content' : ''}`}>
          <Markdown>{message.content}</Markdown>
          {message.status === 'streaming' && <span className="streaming-caret" />}
        </div>

        {/* Clean Grounded Sources Footer */}
        {message.role === 'assistant' && message.sources && message.sources.length > 0 && message.status !== 'streaming' && (
          <div className="grounded-sources-footer">
            <div className="grounded-footer-info">
              <BookOpen size={13} className="text-accent" />
              <span>Grounded in <strong>{docNamesSummary}</strong> ({message.sources.length} passage{message.sources.length > 1 ? 's' : ''} extracted)</span>
            </div>
            <button
              type="button"
              className="grounded-toggle-btn"
              onClick={() => setShowSources((prev) => !prev)}
            >
              {showSources ? 'Hide analysis' : 'View analysis & passages'}
            </button>
          </div>
        )}

        {/* Dynamic Follow-up Questions */}
        {message.follow_ups && message.follow_ups.length > 0 && message.status !== 'streaming' && (
          <div className="follow-ups-area">
            <span className="follow-ups-label">
              <Wand2 size={12} /> Suggested Follow-ups:
            </span>
            <div className="follow-ups-list">
              {message.follow_ups.map((q, qIdx) => (
                <button
                  key={qIdx}
                  className="follow-up-btn"
                  onClick={() => onSuggestion(q)}
                >
                  <span>{q}</span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  canUpload,
  documentsReady,
  generating,
  onStop,
  onFiles,
  uploads,
  persona,
  onPersonaChange,
  isDragging = false,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  disabled: boolean
  canUpload: boolean
  documentsReady: boolean
  generating: boolean
  onStop: () => void
  onFiles: (files: File[]) => void
  uploads: UploadItem[]
  persona: Persona
  onPersonaChange: (p: Persona) => void
  isDragging?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [listening, setListening] = useState(false)
  const [boxDragOver, setBoxDragOver] = useState(false)
  const boxDragCounter = useRef(0)

  const handleBoxDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      boxDragCounter.current += 1
      setBoxDragOver(true)
    }
  }

  const handleBoxDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleBoxDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    boxDragCounter.current -= 1
    if (boxDragCounter.current <= 0) {
      boxDragCounter.current = 0
      setBoxDragOver(false)
    }
  }

  const handleBoxDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    boxDragCounter.current = 0
    setBoxDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFiles(Array.from(e.dataTransfer.files))
    }
  }

  // Speech to text support
  const toggleListening = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).webkitSpeechRecognition

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.')
      return
    }

    if (listening) {
      setListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => setListening(true)
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      onChange(value ? `${value} ${transcript}` : transcript)
      setListening(false)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.start()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit(event)
    }
  }

  return (
    <div className="composer-area">
      <div className="composer-top-row">
        <div className="persona-picker">
          <span className="persona-label">Mode:</span>
          {(['standard', 'concise', 'deep', 'executive', 'technical'] as Persona[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`persona-chip ${persona === p ? 'active' : ''}`}
              onClick={() => onPersonaChange(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <div className="composer-status-hint">
          {!documentsReady ? (
            <span className="hint-warning">
              <AlertCircle size={12} /> Upload documents to enable grounded search
            </span>
          ) : generating ? (
            <span className="hint-generating">
              <LoaderCircle size={12} className="spin" /> Streaming response...
            </span>
          ) : (
            <span className="hint-ready">
              <CheckCircle2 size={12} /> Knowledge base active
            </span>
          )}
        </div>
      </div>

      <form
        className={`composer-box ${boxDragOver || isDragging ? 'drag-over' : ''}`}
        onSubmit={onSubmit}
        onDragEnter={handleBoxDragEnter}
        onDragOver={handleBoxDragOver}
        onDragLeave={handleBoxDragLeave}
        onDrop={handleBoxDrop}
      >
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".pdf,.docx,.doc,.csv,.txt,.md,.json,.py,.ts,.js"
          multiple
          disabled={!canUpload}
          onChange={(event) => {
            onFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />

        <button
          className="composer-btn"
          type="button"
          title={canUpload ? 'Upload or drag & drop files (PDF, DOCX, CSV, TXT, MD, Code)' : 'Add API key first'}
          disabled={!canUpload}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={17} />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          maxLength={3000}
          placeholder={
            boxDragOver || isDragging
              ? 'Drop files here to upload to knowledge base...'
              : documentsReady
              ? 'Ask anything grounded in your documents...'
              : 'Upload or drop documents to begin...'
          }
          disabled={disabled || generating}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button
          type="button"
          className={`composer-btn ${listening ? 'listening' : ''}`}
          onClick={toggleListening}
          title={listening ? 'Listening...' : 'Voice Dictation'}
        >
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        {generating ? (
          <button className="send-btn stop" type="button" onClick={onStop} title="Stop generating">
            <Square size={14} />
          </button>
        ) : (
          <button
            className="send-btn"
            type="submit"
            disabled={disabled || !value.trim()}
            title="Send query (Enter)"
          >
            <Send size={15} />
          </button>
        )}
      </form>

      {uploads.length > 0 && (
        <div className="composer-uploads-tray">
          {uploads.map((upload) => (
            <UploadStatusCard key={upload.id} upload={upload} />
          ))}
        </div>
      )}
    </div>
  )
}

function UploadStatusCard({ upload }: { upload: UploadItem }) {
  const isDone = upload.status === 'ready'
  const isErr = upload.status === 'failed'

  return (
    <div className={`upload-card ${upload.status}`}>
      <div className="upload-card-top">
        <span className="upload-fname" title={upload.file.name}>
          {upload.file.name}
        </span>
        <span className={`upload-badge ${upload.status}`}>
          {isDone ? (
            <><CheckCircle2 size={12} /> Indexed</>
          ) : isErr ? (
            <><AlertCircle size={12} /> Error</>
          ) : (
            <><LoaderCircle size={12} className="spin" /> {upload.status === 'processing' ? 'Embedding' : 'Uploading'}</>
          )}
        </span>
      </div>
      {!isDone && !isErr && (
        <div className="upload-progress-bar">
          <div className="upload-progress-fill" style={{ width: `${upload.progress}%` }} />
        </div>
      )}
      {upload.error && <span className="upload-err-msg">{upload.error}</span>}
    </div>
  )
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function DocumentDrawer({
  data,
  highlightedChunkIndex: _highlightedChunkIndex,
  onClose,
}: {
  data: DocumentPreviewData | null
  highlightedChunkIndex?: number
  onClose: () => void
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)

  // Normalize pages data
  const pages = useMemo(() => {
    if (!data) return []
    if (data.pages && data.pages.length > 0) return data.pages
    if (data.full_text) {
      const paras = data.full_text.split('\n\n').map((p) => p.trim()).filter(Boolean)
      return [{ page_number: 1, text: data.full_text, paragraphs: paras }]
    }
    return []
  }, [data])

  // Count total occurrences of search term in document
  const totalMatches = useMemo(() => {
    if (!searchTerm.trim() || pages.length === 0) return 0
    const query = searchTerm.trim().toLowerCase()
    let count = 0
    for (const page of pages) {
      for (const p of page.paragraphs) {
        let pos = 0
        const lower = p.toLowerCase()
        while ((pos = lower.indexOf(query, pos)) !== -1) {
          count++
          pos += query.length
        }
      }
    }
    return count
  }, [pages, searchTerm])


  // Scroll active match into view smoothly
  useEffect(() => {
    if (totalMatches > 0) {
      const activeEl = document.getElementById('active-search-hit')
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [currentMatchIdx, totalMatches])

  if (!data) return null

  const handleNextMatch = () => {
    if (totalMatches > 0) {
      setCurrentMatchIdx((prev) => (prev + 1) % totalMatches)
    }
  }

  const handlePrevMatch = () => {
    if (totalMatches > 0) {
      setCurrentMatchIdx((prev) => (prev - 1 + totalMatches) % totalMatches)
    }
  }

  let matchCounter = 0

  const renderTextWithHighlights = (text: string) => {
    if (!searchTerm.trim()) return text

    const query = searchTerm.trim()
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'))

    return parts.map((part, idx) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        const thisMatch = matchCounter++
        const isCurrent = thisMatch === currentMatchIdx
        return (
          <mark
            key={idx}
            className={`search-hit ${isCurrent ? 'current' : ''}`}
            id={isCurrent ? 'active-search-hit' : undefined}
          >
            {part}
          </mark>
        )
      }
      return part
    })
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-group">
            <div className="drawer-doc-title">
              <span className="file-icon-wrap">{getFileIcon(data.doc_name)}</span>
              <h2>{data.doc_name}</h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close document">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-search-bar">
          <div className="search-input-wrap">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              placeholder="Search in document... (Enter for next, Shift+Enter for previous)"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentMatchIdx(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) handlePrevMatch()
                  else handleNextMatch()
                } else if (e.key === 'Escape') {
                  setSearchTerm('')
                }
              }}
            />
            {searchTerm && (
              <button className="search-clear-btn" onClick={() => setSearchTerm('')} title="Clear search">
                <X size={13} />
              </button>
            )}
          </div>

          {searchTerm.trim() && (
            <div className="search-nav-controls">
              <span className={`match-counter ${totalMatches === 0 ? 'no-match' : ''}`}>
                {totalMatches > 0 ? `${currentMatchIdx + 1} of ${totalMatches}` : '0 matches'}
              </span>
              <button
                className="icon-button search-nav-btn"
                onClick={handlePrevMatch}
                disabled={totalMatches === 0}
                title="Previous match (Shift+Enter)"
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="icon-button search-nav-btn"
                onClick={handleNextMatch}
                disabled={totalMatches === 0}
                title="Next match (Enter)"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="drawer-reader-body">
          {pages.length === 0 ? (
            <div className="drawer-empty">No content found in this document.</div>
          ) : (
            <div className="document-sheet">
              {pages.map((page, pageIdx) => (
                <article key={page.page_number || pageIdx} className="doc-page-section">
                  {pages.length > 1 && (
                    <div className="doc-page-header">
                      <span>PAGE {page.page_number} OF {data.total_pages || pages.length}</span>
                    </div>
                  )}

                  <div className="doc-page-content">
                    {page.paragraphs.map((para, paraIdx) => {
                      const trimmed = para.trim()
                      if (!trimmed) return null

                      // Detect headings: short uppercase lines or legal keywords
                      const isHeading =
                        (trimmed.length < 90 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) ||
                        trimmed.startsWith('REPORTABLE') ||
                        trimmed.startsWith('IN THE SUPREME COURT') ||
                        trimmed.startsWith('CIVIL APPEAL') ||
                        trimmed.startsWith('J U D G M E N T') ||
                        trimmed.startsWith('JUDGMENT')

                      const isNumberedClause = /^\d+\.\s/.test(trimmed)

                      return (
                        <p
                          key={paraIdx}
                          className={`doc-paragraph ${isHeading ? 'doc-heading' : ''} ${isNumberedClause ? 'doc-numbered-clause' : ''}`}
                        >
                          {renderTextWithHighlights(para)}
                        </p>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export function SettingsModal({
  open,
  apiKey,
  model,
  availableModels,
  onClose,
  onSave,
  onTest,
  testStatus,
}: {
  open: boolean
  apiKey: string
  model: string
  availableModels: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (key: string, model: string) => void
  onTest: (key: string) => void
  testStatus: string
}) {
  const [key, setKey] = useState(apiKey)
  const [selectedModel, setSelectedModel] = useState(model)
  const [visible, setVisible] = useState(false)

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="eyebrow"><KeyRound size={13} /> Engine Configuration</span>
            <h2 id="settings-title">Gemini AI Connection</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={17} />
          </button>
        </div>

        <p className="modal-desc">
          Configure your Google Gemini API key and model. Keys entered here are stored locally in your browser session and never sent to third parties.
        </p>

        <div className="form-group">
          <label htmlFor="gemini-key">Gemini API Key</label>
          <div className="input-secret-box">
            <input
              id="gemini-key"
              type={visible ? 'text' : 'password'}
              value={key}
              placeholder="AIzaSy..."
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Hide API key' : 'Show API key'}
            >
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="model-select">Active Generative Model</label>
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {availableModels.length > 0 ? (
              availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))
            ) : (
              <>
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (Recommended)</option>
                <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                <option value="gemini-flash-latest">Gemini Flash Latest</option>
              </>
            )}
          </select>
        </div>

        {testStatus && (
          <div className={`status-alert ${testStatus.startsWith('Connected') ? 'success' : 'error'}`}>
            {testStatus.startsWith('Connected') ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
            <span>{testStatus}</span>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn secondary" onClick={() => onTest(key)}>
            Test Connection
          </button>
          <button className="btn primary" onClick={() => onSave(key, selectedModel)}>
            Save Configuration
          </button>
        </div>
      </section>
    </div>
  )
}

function formatDate(value: string) {
  if (!value) return 'Recent'
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return 'Recent'
  }
}
