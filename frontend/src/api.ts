import type { DocumentItem, DocumentPreviewData, HistoryItem, Source } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const data = await response.json() as { detail?: string }
      message = data.detail || message
    } catch {
      // Keep fallback
    }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}

export function authHeaders(apiKey?: string, json = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const key = (apiKey && apiKey.trim()) || localStorage.getItem('gemini_api_key') || ''
  if (key) headers['x-gemini-api-key'] = key
  return headers
}

export function checkKey() {
  return request<{ configured: boolean; default_model?: string; available_models?: Array<{ id: string; name: string }> }>('/api/check-key')
}

export function listDocuments() {
  return request<DocumentItem[]>('/api/documents')
}

export function previewDocument(name: string) {
  return request<DocumentPreviewData>(`/api/documents/${encodeURIComponent(name)}/preview`)
}

export function uploadDocument(file: File, apiKey?: string) {
  const body = new FormData()
  body.append('files', file)
  return request<{ files: Array<{ filename: string; chunks: number; pages: number; type: string }> }>('/api/upload', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body,
  })
}

export function deleteDocument(name: string, apiKey?: string) {
  return request(`/api/documents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  })
}

export function clearDocuments(apiKey?: string) {
  return request('/api/clear', {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  })
}

export function chat(
  message: string,
  history: HistoryItem[],
  apiKey: string,
  persona = 'standard',
  docFilter?: string[],
  modelName?: string,
  signal?: AbortSignal
) {
  return request<{ reply: string; sources: Source[]; follow_ups?: string[] }>('/api/chat', {
    method: 'POST',
    headers: authHeaders(apiKey, true),
    body: JSON.stringify({
      message,
      history,
      persona,
      doc_filter: docFilter && docFilter.length > 0 ? docFilter : null,
      model_name: modelName || null,
    }),
    signal,
  })
}

export interface ChatStreamCallbacks {
  onStatus?: (step: string, message: string) => void
  onSources?: (sources: Source[]) => void
  onDelta?: (delta: string) => void
  onSuggestions?: (suggestions: string[]) => void
  onDone?: (reply: string, sources: Source[]) => void
  onError?: (error: string) => void
}

export async function chatStream(
  message: string,
  history: HistoryItem[],
  apiKey: string,
  callbacks: ChatStreamCallbacks,
  persona = 'standard',
  docFilter?: string[],
  modelName?: string,
  signal?: AbortSignal
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: authHeaders(apiKey, true),
    body: JSON.stringify({
      message,
      history,
      persona,
      doc_filter: docFilter && docFilter.length > 0 ? docFilter : null,
      model_name: modelName || null,
    }),
    signal,
  })

  if (!response.ok) {
    let errMessage = `Streaming request failed (${response.status})`
    try {
      const errJson = await response.json() as { detail?: string }
      errMessage = errJson.detail || errMessage
    } catch {
      // fallback
    }
    throw new ApiError(errMessage, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new ApiError('Readable stream not supported by browser or response.', 500)
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = 'message'
  let fullReply = ''
  let collectedSources: Source[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) {
          currentEvent = 'message'
          continue
        }

        if (line.startsWith('event:')) {
          currentEvent = line.replace('event:', '').trim()
        } else if (line.startsWith('data:')) {
          const rawData = line.replace('data:', '').trim()
          try {
            const data = JSON.parse(rawData)
            if (currentEvent === 'status') {
              callbacks.onStatus?.(data.step || '', data.message || '')
            } else if (currentEvent === 'sources') {
              collectedSources = data.sources || []
              callbacks.onSources?.(collectedSources)
            } else if (currentEvent === 'delta') {
              fullReply += data.delta || ''
              callbacks.onDelta?.(data.delta || '')
            } else if (currentEvent === 'suggestions') {
              callbacks.onSuggestions?.(data.suggestions || [])
            } else if (currentEvent === 'done') {
              callbacks.onDone?.(data.reply || fullReply, collectedSources)
            } else if (currentEvent === 'error') {
              callbacks.onError?.(data.error || 'Stream error occurred.')
            }
          } catch {
            // raw string delta fallback
            if (currentEvent === 'delta') {
              fullReply += rawData
              callbacks.onDelta?.(rawData)
            }
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return
    }
    throw err
  }
}
