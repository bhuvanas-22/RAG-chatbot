// State Management
const state = {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    isEnvKeyConfigured: false,
    chatHistory: [],
    documents: [],
    isUploading: false,
    isGenerating: false
};

// DOM Elements
const docList = document.getElementById('documents-list');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const uploadStatus = document.getElementById('upload-status');
const uploadStatusText = document.getElementById('upload-status-text');
const clearDbBtn = document.getElementById('clear-db-btn');
const keyStatusDot = document.getElementById('key-status-dot');
const keyStatusText = document.getElementById('key-status-text');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const charCount = document.getElementById('char-count');
const clearChatBtn = document.getElementById('clear-chat-btn');
const coverageBadge = document.getElementById('coverage-badge');
const typingIndicator = document.getElementById('typing-indicator');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const apiKeyInput = document.getElementById('api-key-input');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
const modalStatus = document.getElementById('modal-status');

// Init application
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check if API key is set in .env
    await checkEnvApiKey();
    
    // 2. Load settings state
    updateKeyIndicator();
    
    // 3. Load documents from server
    await fetchDocuments();
    
    // 4. Setup all event listeners
    setupEventListeners();
});

// Check if backend env has API key
async function checkEnvApiKey() {
    try {
        const response = await fetch('/api/check-key');
        if (response.ok) {
            const data = await response.json();
            state.isEnvKeyConfigured = data.configured;
        }
    } catch (error) {
        console.error("Error checking env API key:", error);
    }
}

// Update API key status indicator
function updateKeyIndicator() {
    const hasKey = state.isEnvKeyConfigured || state.apiKey.trim().length > 0;
    if (hasKey) {
        keyStatusDot.className = 'dot dot-success';
        keyStatusText.textContent = state.isEnvKeyConfigured 
            ? 'Gemini Connected (System Key)' 
            : 'Gemini Connected (User Key)';
        sendBtn.disabled = state.isGenerating || chatInput.value.trim().length === 0;
    } else {
        keyStatusDot.className = 'dot dot-danger dot-pulse';
        keyStatusText.textContent = 'Gemini API Key Missing';
        sendBtn.disabled = true;
    }
}

// Get API Key for HTTP Headers
function getActiveApiKey() {
    return state.apiKey;
}

// Load documents from backend
async function fetchDocuments() {
    try {
        const response = await fetch('/api/documents');
        if (response.ok) {
            state.documents = await response.json();
            renderDocuments();
        } else {
            console.error("Failed to fetch documents");
        }
    } catch (error) {
        console.error("Error fetching documents:", error);
    }
}

// Render document items in sidebar
function renderDocuments() {
    if (state.documents.length === 0) {
        docList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-folder-open"></i>
                <p>No documents ingested yet</p>
            </div>
        `;
        clearDbBtn.classList.add('hidden');
        coverageBadge.textContent = '0 documents active';
        coverageBadge.classList.remove('active');
        return;
    }

    clearDbBtn.classList.remove('hidden');
    coverageBadge.textContent = `${state.documents.length} document${state.documents.length > 1 ? 's' : ''} active`;
    coverageBadge.classList.add('active');

    docList.innerHTML = state.documents.map(doc => {
        // Date formatting
        let dateStr = 'unknown date';
        if (doc.added_at) {
            try {
                const date = new Date(doc.added_at);
                dateStr = date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
            } catch (e) {}
        }
        
        return `
            <div class="doc-item" data-filename="${escapeHtml(doc.name)}">
                <div class="doc-info">
                    <i class="fa-solid fa-file-pdf doc-icon"></i>
                    <div class="doc-details">
                        <span class="doc-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
                        <span class="doc-meta">${doc.chunks_count} chunks • ${dateStr}</span>
                    </div>
                </div>
                <button class="icon-btn delete-doc-btn" data-filename="${escapeHtml(doc.name)}" title="Delete document">
                    <i class="fa-solid fa-trash-can text-danger"></i>
                </button>
            </div>
        `;
    }).join('');
    
    // Add delete listeners
    document.querySelectorAll('.delete-doc-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const filename = btn.getAttribute('data-filename');
            await deleteDocument(filename);
        });
    });
}

// Delete document API call
async function deleteDocument(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    
    try {
        const headers = {};
        if (state.apiKey) {
            headers['x-gemini-api-key'] = state.apiKey;
        }
        
        const response = await fetch(`/api/documents/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            headers: headers
        });
        
        if (response.ok) {
            await fetchDocuments();
        } else {
            const data = await response.json();
            alert(data.detail || "Failed to delete document.");
        }
    } catch (error) {
        console.error("Error deleting document:", error);
        alert("Connection error while deleting document.");
    }
}

// Clear all files index API call
async function clearAllDocuments() {
    if (!confirm("Are you sure you want to clear the entire knowledge base? This action cannot be undone.")) return;
    
    try {
        const headers = {};
        if (state.apiKey) {
            headers['x-gemini-api-key'] = state.apiKey;
        }
        const response = await fetch('/api/clear', {
            method: 'DELETE',
            headers: headers
        });
        
        if (response.ok) {
            await fetchDocuments();
        } else {
            const data = await response.json();
            alert(data.detail || "Failed to clear knowledge base.");
        }
    } catch (error) {
        console.error("Error clearing knowledge base:", error);
        alert("Connection error while clearing knowledge base.");
    }
}

// Upload documents API call
async function uploadFiles(files) {
    if (files.length === 0) return;
    
    const hasKey = state.isEnvKeyConfigured || state.apiKey.trim().length > 0;
    if (!hasKey) {
        showModal();
        showModalStatus("An API Key is required before uploading documents.", "error");
        return;
    }
    
    state.isUploading = true;
    
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
            const statusMsg = files.length > 1
                ? `Processing ${file.name} (${sizeMb} MB) [${i + 1}/${files.length}]...`
                : `Processing ${file.name} (${sizeMb} MB) — Chunking & Embedding...`;
                
            toggleUploadUI(true, statusMsg);
            
            const formData = new FormData();
            formData.append('files', file);
            
            const headers = {};
            if (state.apiKey) {
                headers['x-gemini-api-key'] = state.apiKey;
            }
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                headers: headers,
                body: formData
            });
            
            if (response.ok) {
                await fetchDocuments();
            } else {
                let errorMsg = "Error occurred during file uploading.";
                try {
                    const data = await response.json();
                    errorMsg = data.detail || errorMsg;
                } catch (e) {}
                alert(`Failed to upload "${file.name}": ${errorMsg}`);
            }
        }
    } catch (error) {
        console.error("Error uploading files:", error);
        alert("Connection error occurred while uploading files.");
    } finally {
        toggleUploadUI(false);
    }
}

function toggleUploadUI(show, text = "") {
    state.isUploading = show;
    if (show) {
        uploadStatusText.textContent = text;
        uploadStatus.classList.remove('hidden');
        dropzone.style.pointerEvents = 'none';
        dropzone.style.opacity = '0.6';
    } else {
        uploadStatus.classList.add('hidden');
        dropzone.style.pointerEvents = 'auto';
        dropzone.style.opacity = '1';
    }
}

// Setup App UI event listeners
function setupEventListeners() {
    // Settings modal opening/closing
    settingsBtn.addEventListener('click', showModal);
    closeModalBtn.addEventListener('click', hideModal);
    cancelSettingsBtn.addEventListener('click', hideModal);
    
    // Toggle API Key visibility
    toggleKeyVisibility.addEventListener('click', () => {
        const type = apiKeyInput.type === 'password' ? 'text' : 'password';
        apiKeyInput.type = type;
        const icon = toggleKeyVisibility.querySelector('i');
        icon.className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
    
    // Save settings
    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        state.apiKey = key;
        localStorage.setItem('gemini_api_key', key);
        updateKeyIndicator();
        showModalStatus("Settings saved successfully!", "success");
        setTimeout(hideModal, 1000);
    });
    
    // Browse Files button triggering hidden file input
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    fileInput.addEventListener('change', () => {
        uploadFiles(fileInput.files);
    });
    
    // Drag & Drop event bindings
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });
    
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        uploadFiles(files);
    });
    
    // Clear Database index click listener
    clearDbBtn.addEventListener('click', clearAllDocuments);
    
    // Chat character counter and keypress settings
    chatInput.addEventListener('input', () => {
        // Auto grow height
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        
        // Counter
        const len = chatInput.value.length;
        charCount.textContent = len;
        
        // Enable send
        const hasKey = state.isEnvKeyConfigured || state.apiKey.trim().length > 0;
        sendBtn.disabled = !hasKey || state.isGenerating || chatInput.value.trim().length === 0;
    });
    
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });
    
    sendBtn.addEventListener('click', sendMessage);
    clearChatBtn.addEventListener('click', clearChatHistory);
    
    // Event delegation to toggle Sources content collapse
    chatMessages.addEventListener('click', (e) => {
        const trigger = e.target.closest('.sources-trigger');
        if (trigger) {
            trigger.classList.toggle('active');
            const content = trigger.nextElementSibling;
            content.classList.toggle('show');
        }
    });
}

// Modal View togglers
function showModal() {
    apiKeyInput.value = state.apiKey;
    settingsModal.classList.remove('hidden');
    modalStatus.className = 'modal-status hidden';
}

function hideModal() {
    settingsModal.classList.add('hidden');
}

function showModalStatus(text, type) {
    modalStatus.textContent = text;
    modalStatus.className = `modal-status ${type}`;
}

// Chat Flow: Send Message
async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || state.isGenerating) return;
    
    // 1. Reset Textarea
    chatInput.value = '';
    chatInput.style.height = 'auto';
    charCount.textContent = '0';
    sendBtn.disabled = true;
    
    // Remove welcome box if showing
    const welcomeBox = document.querySelector('.welcome-box');
    if (welcomeBox) {
        welcomeBox.remove();
    }
    
    // 2. Append User Message
    appendMessage('user', text);
    
    // 3. Update status & show typing
    state.isGenerating = true;
    typingIndicator.classList.remove('hidden');
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // 4. API Request Setup
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (state.apiKey) {
            headers['x-gemini-api-key'] = state.apiKey;
        }
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                message: text,
                history: state.chatHistory
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Hide typing indicator
            typingIndicator.classList.add('hidden');
            
            // Append assistant response
            appendMessage('assistant', data.reply, data.sources);
            
            // Update local memory
            state.chatHistory.push({ role: 'user', content: text });
            state.chatHistory.push({ role: 'model', content: data.reply });
        } else {
            const data = await response.json();
            typingIndicator.classList.add('hidden');
            appendMessage('assistant', `⚠️ **Error**: ${data.detail || "Failed to generate reply."}`);
        }
    } catch (error) {
        console.error("Error sending message:", error);
        typingIndicator.classList.add('hidden');
        appendMessage('assistant', "⚠️ **Connection Error**: Failed to reach backend API.");
    } finally {
        state.isGenerating = false;
        updateKeyIndicator();
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Append messages to board
function appendMessage(role, text, sources = []) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}`;
    
    const senderName = role === 'user' ? 'You' : 'RAG Chatbot';
    const parsedText = role === 'user' ? escapeHtml(text) : parseMarkdown(text);
    
    let sourcesHtml = '';
    if (sources && sources.length > 0) {
        const sourceItems = sources.map((src, i) => {
            const percentScore = Math.round(src.score * 100);
            return `
                <div class="source-item">
                    <div class="source-item-header">
                        <span>[Source ${i+1}] ${escapeHtml(src.doc_name)}</span>
                        <span class="source-score">Match: ${percentScore}%</span>
                    </div>
                    <div class="source-text">"${escapeHtml(src.text)}"</div>
                </div>
            `;
        }).join('');
        
        sourcesHtml = `
            <div class="msg-sources">
                <div class="sources-trigger">
                    <span><i class="fa-solid fa-circle-info"></i> View Sources & Context (${sources.length})</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </div>
                <div class="sources-content">
                    ${sourceItems}
                </div>
            </div>
        `;
    }
    
    msgEl.innerHTML = `
        <div class="msg-header">${senderName}</div>
        <div class="msg-bubble">
            ${parsedText}
        </div>
        ${sourcesHtml}
    `;
    
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Reset chat history
function clearChatHistory() {
    if (state.chatHistory.length === 0) return;
    if (!confirm("Are you sure you want to clear the conversation history?")) return;
    
    state.chatHistory = [];
    chatMessages.innerHTML = `
        <div class="welcome-box">
            <div class="welcome-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <h2>Welcome to RAG Chatbot</h2>
            <p>An intelligent retrieval-augmented assistant. Upload documents in the sidebar, and I will search through them to answer your questions with precise citations.</p>
            <div class="welcome-steps">
                <div class="step">
                    <span class="step-num">1</span>
                    <p>Configure your <strong>Gemini API Key</strong> in settings <i class="fa-solid fa-gear"></i></p>
                </div>
                <div class="step">
                    <span class="step-num">2</span>
                    <p>Drag and drop <strong>PDF, TXT, or MD</strong> files to ingest</p>
                </div>
                <div class="step">
                    <span class="step-num">3</span>
                    <p>Ask questions and view <strong>grounded sources</strong></p>
                </div>
            </div>
        </div>
    `;
}

// Markdown Parser Helper
function parseMarkdown(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold text
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic text
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Unordered lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Replace newlines with breaks (outside of pre blocks)
    // Simple approach: split by pre, replace newlines in other segments, then join
    const segments = html.split(/(<pre>[\s\S]*?<\/pre>)/);
    for (let i = 0; i < segments.length; i++) {
        if (!segments[i].startsWith('<pre>')) {
            segments[i] = segments[i].replace(/\n/g, '<br>');
        }
    }
    html = segments.join('');
    
    return html;
}

// Escape HTML utility (prevents injection attacks)
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
