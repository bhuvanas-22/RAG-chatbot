export type DocumentItem = {
  name: string
  chunks_count: number
  added_at: string
  file_type?: string
  pages_count?: number
}

export type HistoryItem = {
  role: 'user' | 'model'
  content: string
}

export type Source = {
  doc_name: string
  text: string
  score: number
  page_number?: number
  section?: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  follow_ups?: string[]
  status?: 'ready' | 'error' | 'streaming'
  searchStep?: string
  timestamp?: string
}

export type UploadItem = {
  id: string
  file: File
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  progress: number
  error?: string
}

export type Theme = 'dark' | 'light'

export type Persona = 'standard' | 'concise' | 'deep' | 'executive' | 'technical'

export type ChatSession = {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  persona: Persona
}

export type DocumentPage = {
  page_number: number
  paragraphs: string[]
  text: string
}

export type DocumentPreviewData = {
  doc_name: string
  file_type?: string
  total_pages?: number
  pages: DocumentPage[]
  full_text?: string
}
