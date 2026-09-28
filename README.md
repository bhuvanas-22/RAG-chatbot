 # Atlas RAG — AI Document Intelligence & Chatbot

An enterprise-grade **Retrieval-Augmented Generation (RAG)** chatbot built with a **Python FastAPI** backend, **ChromaDB** vector database, **Google Gemini 3.8**, and a modern **React 19 + TypeScript + Vite** glassmorphic frontend.

---

## What is RAG? (Beginner Friendly)

Standard AI models answer questions only from their training data. **Retrieval-Augmented Generation (RAG)** connects an AI model to your own private documents:

1. **Upload**: You upload a document (PDF, Word `.docx`, CSV, Markdown, or Code file).
2. **Chunking & Embedding**: The document is split into paragraphs and converted into mathematical vector representations (embeddings).
3. **Storage**: Vectors are saved locally in **ChromaDB**.
4. **Retrieval**: When you ask a question, ChromaDB finds the most relevant document sections via cosine similarity search.
5. **Synthesis**: Google Gemini answers your question using the retrieved sections as context, complete with page-level citations.

---

## Project Structure & Architecture

This project is organized into clean, isolated layers:

```text
RAG-chatbot/
├── backend/                       # Python Backend Service
│   ├── main.py                    # FastAPI server, SSE streaming, document parsers
│   ├── chroma_db/                 # ChromaDB vector store (created at runtime)
│   └── document_store/            # Uploaded files & clean extracts (created at runtime)
│       ├── files/                 # Original uploaded files
│       └── parsed/                # Clean structured page extracts
├── frontend/                      # React 19 Client Application
│   ├── src/                       # React components, document reader, glassmorphic UI
│   │   ├── App.tsx                # Main application state & chat sessions
│   │   ├── components.tsx         # Sidebar, reader drawer, chat bubbles, composer
│   │   ├── api.ts                 # Typed API client & SSE streaming parser
│   │   ├── types.ts               # TypeScript interfaces
│   │   └── App.css                # Glassmorphic dark/light styling system
│   ├── public/                    # Favicon and static assets
│   ├── package.json               # Frontend dependencies (React, Vite, Lucide)
│   └── vite.config.ts             # Dev proxy and build pipeline configuration
├── static/                        # Production frontend build (served by FastAPI)
├── sample_docs/                   # Sample document files for testing
│   └── sample_document.txt        # Sample text document
├── requirements.txt               # General Python dependencies (FastAPI, Gemini, ChromaDB)
├── run.py                         # Single-command root launcher (python run.py)
├── Dockerfile                     # Multi-stage production container build
├── Procfile                       # Process configuration for Render / Railway / Heroku
├── .env.example                   # Environment configuration template
├── .gitignore                     # Git exclusion rules for clean repository
├── LICENSE                        # MIT License
└── README.md                      # Documentation
```

### Understanding Dependencies:
- **`requirements.txt` (Root)**: Lists all **Python backend** packages (`fastapi`, `uvicorn`, `chromadb`, `google-generativeai`, `pypdf`, `python-docx`). Installed via `pip`.
- **`frontend/package.json`**: Lists all **JavaScript/TypeScript frontend** packages (`react`, `lucide-react`, `vite`, `typescript`). Installed via `npm`.

---

## Features

- **Real-Time Token Streaming**: Server-Sent Events (SSE) streaming character-by-character with live generation indicators.
- **Deep Page Citations**: PDF page tracking (`Page X`) and section matching with interactive popover previews.
- **Continuous Document Reader**: Clean document viewer without developer chunk IDs; formatted like a clean document sheet.
- **In-Document Search**: Live Ctrl+F search inside documents with keyword highlighting, match counter, and step navigation.
- **Multi-Format Ingestion**: Ingest PDF, Word (`.docx`), CSV spreadsheets, Markdown, JSON, and Code files (`.py`, `.ts`, `.js`, etc.).
- **Multi-Session Chat History**: Manage, switch between, and persist multiple conversations in the sidebar.
- **Dynamic Follow-Up Questions**: 3 AI-generated follow-up questions suggested after each response.
- **Persona & Style Selector**: Switch modes between *Standard*, *Concise*, *Deep Analysis*, *Executive Briefing*, and *Technical*.
- **Voice Dictation & Audio Readout**: Speech-to-text voice input and text-to-speech voice playback.
- **Chat Export**: Download conversations as formatted Markdown files.
- **Modern Glassmorphic UI**: Ultra-refined dark and light themes, typography with Plus Jakarta Sans & JetBrains Mono, and micro-animations.

---

## Beginner Setup Guide (Step-by-Step)

### Prerequisites

Make sure you have installed on your computer:
1. **Python 3.10 or higher**: [Download Python](https://www.python.org/downloads/)
2. **Node.js 18 or higher & npm**: [Download Node.js](https://nodejs.org/)
3. **A Gemini API Key**: Get a free key at [Google AI Studio](https://aistudio.google.com/)

---

### Step 1: Clone the Repository & Open Terminal

```powershell
git clone https://github.com/bhuvanas-22/RAG-chatbot.git
cd RAG-chatbot
```

---

### Step 2: Set Up Python Virtual Environment

A virtual environment keeps project dependencies isolated from other Python packages on your computer.

**On Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
*(If PowerShell shows an execution policy error, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` then try again).*

**On macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

---

### Step 3: Install Backend Dependencies

Install the Python packages from the root `requirements.txt`:

```powershell
pip install -r requirements.txt
```

---

### Step 4: Install Frontend Dependencies

Navigate into `frontend/` and install the Node packages:

```powershell
cd frontend
npm install
cd ..
```

---

### Step 5: Configure Your Gemini API Key

Copy the `.env.example` file and create `.env`:

**On Windows:**
```powershell
Copy-Item .env.example .env
```

**On macOS / Linux:**
```bash
cp .env.example .env
```

Open `.env` in any text editor and paste your API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
```

---

### Step 6: Run the Application

You can run the app in **Production Mode** (single port) or **Developer Mode** (hot-reloading):

#### Method A: Production Mode (Recommended for Beginners)
Build the frontend and run everything together on port `8000`:

```powershell
# 1. Build the React frontend
cd frontend
npm run build
cd ..

# 2. Start the unified application
python run.py
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser!

#### Method B: Developer Mode (Live Hot Reloading)
Open two terminal windows:

- **Terminal 1 (Backend)**:
  ```powershell
  python run.py
  ```
- **Terminal 2 (Frontend with Vite HMR)**:
  ```powershell
  cd frontend
  npm run dev
  ```
Open **[http://localhost:5173](http://localhost:5173)** in your browser. Any edits in `frontend/src/` will update instantly on your screen!

---

## Docker Deployment (Containerization)

A multi-stage `Dockerfile` is included so you can package and run the entire project in a single container without needing Python or Node installed on the host machine.

### 1. Build the Docker Image
```bash
docker build -t atlas-rag-chatbot .
```

### 2. Run the Container
```bash
docker run -d -p 8000:8000 -e GEMINI_API_KEY="your_api_key_here" atlas-rag-chatbot
```

Visit `http://localhost:8000` in your browser.

---

## Free Cloud Deployment Guide

### Deploying on Render (Render.com)

1. Push your repository to **GitHub**.
2. Sign in to [Render](https://render.com/) and click **New + > Web Service**.
3. Connect your GitHub repository.
4. Set the following fields:
   - **Environment**: `Python`
   - **Build Command**:
     ```bash
     pip install -r requirements.txt && cd frontend && npm install && npm run build && cd ..
     ```
   - **Start Command**:
     ```bash
     python run.py
     ```
5. In **Environment Variables**, add:
   - `GEMINI_API_KEY`: `your_gemini_api_key`
   - `GEMINI_MODEL`: `gemini-3.8-flash`
   - `ALLOWED_ORIGINS`: `https://your-service-name.onrender.com`
6. Click **Create Web Service**. Render will build and deploy your app automatically!

### Deploying on Railway / Heroku

Both Railway and Heroku detect the included [Procfile](file:///c:/Users/LENOVO/OneDrive/Desktop/RAG-chatbot/Procfile):
```text
web: python run.py
```
Set your `GEMINI_API_KEY` in the environment settings and deploy with one click.

---

## API Reference

The backend provides clean REST and streaming endpoints:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/check-key` | Validates Gemini API key status and lists available models. |
| `GET` | `/api/documents` | Lists all indexed documents, chunk counts, and page counts. |
| `GET` | `/api/documents/{doc_name}/preview` | Fetches structured document pages and paragraphs for the reader drawer. |
| `POST` | `/api/upload` | Ingests, parses, and embeds PDF, DOCX, CSV, TXT, or MD files. |
| `DELETE` | `/api/documents/{doc_name}` | Deletes a document and its embeddings from ChromaDB. |
| `DELETE` | `/api/clear` | Clears all documents and resets the vector store. |
| `POST` | `/api/chat` | Standard synchronous RAG question-answering. |
| `POST` | `/api/chat/stream` | Real-time Server-Sent Events (SSE) token streaming with status steps. |

---

## License

This project is licensed under the [MIT License](LICENSE).
