import io
import os
import csv
import json
import hmac
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Body
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader
import chromadb
from chromadb.config import Settings as ChromaSettings
from dotenv import load_dotenv
import google.generativeai as genai

# Try optional python-docx
try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Suppress noisy external loggers
logging.getLogger("chromadb.telemetry.posthog").setLevel(logging.CRITICAL)
logging.getLogger("google").setLevel(logging.WARNING)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)

# Load environment variables (supports backend/.env or project root .env)
load_dotenv()
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
load_dotenv(os.path.join(BASE_DIR, ".env"))

app = FastAPI(title="RAG - Chatbot Backend", version="2.0.0")

# Runtime configuration
DEFAULT_ALLOWED_ORIGINS = "http://127.0.0.1:8000,http://localhost:8000,http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
]
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-001")

try:
    MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
    if MAX_UPLOAD_SIZE_MB < 1:
        raise ValueError
except ValueError:
    raise RuntimeError("MAX_UPLOAD_SIZE_MB must be a positive whole number.")

MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Text Splitter with sentence/paragraph awareness
def split_text(text: str, chunk_size: int = 900, chunk_overlap: int = 150) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = start + chunk_size
        if end >= text_len:
            chunks.append(text[start:].strip())
            break

        # Priority 1: paragraph split
        split_point = text.rfind('\n\n', start + chunk_size - 200, end)
        # Priority 2: line split
        if split_point == -1:
            split_point = text.rfind('\n', start + chunk_size - 150, end)
        # Priority 3: sentence split
        if split_point == -1:
            split_point = text.rfind('. ', start + chunk_size - 100, end)
            if split_point != -1:
                split_point += 1  # include the period
        # Priority 4: space split
        if split_point == -1:
            split_point = text.rfind(' ', start + chunk_size - 100, end)

        if split_point != -1 and split_point > start:
            chunks.append(text[start:split_point].strip())
            start = max(start + 1, split_point - chunk_overlap)
        else:
            chunks.append(text[start:end].strip())
            start = end - chunk_overlap

    return [c for c in chunks if c and len(c.strip()) > 10]


# Document Parsers with page number and section awareness
def extract_pdf_chunks(content: bytes, filename: str) -> List[Dict[str, Any]]:
    reader = PdfReader(io.BytesIO(content))
    chunks = []
    chunk_idx = 0
    for page_num, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
            if not page_text.strip():
                continue
            page_slices = split_text(page_text, chunk_size=850, chunk_overlap=150)
            for slice_text in page_slices:
                chunks.append({
                    "text": slice_text,
                    "page_number": page_num,
                    "section": f"Page {page_num}",
                    "chunk_index": chunk_idx,
                    "doc_name": filename,
                    "file_type": "pdf"
                })
                chunk_idx += 1
        except Exception as pe:
            logger.warning(f"Error parsing page {page_num} of {filename}: {pe}")
    return chunks

def extract_docx_chunks(content: bytes, filename: str) -> List[Dict[str, Any]]:
    if not HAS_DOCX:
        raise HTTPException(status_code=500, detail="python-docx library is not installed on the server.")
    
    doc = docx.Document(io.BytesIO(content))
    chunks = []
    current_section = "Overview"
    buffer = []
    buf_len = 0
    chunk_idx = 0

    for para in doc.paragraphs:
        txt = para.text.strip()
        if not txt:
            continue
        style_name = para.style.name if para.style else ""
        if "Heading" in style_name or "Title" in style_name:
            if buffer and buf_len > 200:
                chunks.append({
                    "text": "\n".join(buffer),
                    "page_number": 1,
                    "section": current_section,
                    "chunk_index": chunk_idx,
                    "doc_name": filename,
                    "file_type": "docx"
                })
                chunk_idx += 1
                buffer = []
                buf_len = 0
            current_section = txt
            continue

        buffer.append(txt)
        buf_len += len(txt)
        if buf_len >= 850:
            chunks.append({
                "text": "\n".join(buffer),
                "page_number": 1,
                "section": current_section,
                "chunk_index": chunk_idx,
                "doc_name": filename,
                "file_type": "docx"
            })
            chunk_idx += 1
            buffer = buffer[-1:] if buffer else []
            buf_len = sum(len(b) for b in buffer)

    if buffer:
        chunks.append({
            "text": "\n".join(buffer),
            "page_number": 1,
            "section": current_section,
            "chunk_index": chunk_idx,
            "doc_name": filename,
            "file_type": "docx"
        })

    return chunks

def extract_csv_chunks(content: bytes, filename: str) -> List[Dict[str, Any]]:
    decoded = content.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(decoded))
    rows = list(reader)
    if not rows:
        return []

    header = rows[0]
    data_rows = rows[1:]
    chunks = []
    chunk_idx = 0
    batch_size = 6

    for i in range(0, len(data_rows), batch_size):
        batch = data_rows[i:i + batch_size]
        text_lines = [f"Table Headers: {', '.join(header)}"]
        for row_num, r in enumerate(batch, start=i + 1):
            row_desc = " | ".join(f"{h}: {val}" for h, val in zip(header, r) if val.strip())
            text_lines.append(f"Row {row_num}: {row_desc}")

        chunk_text = "\n".join(text_lines)
        chunks.append({
            "text": chunk_text,
            "page_number": 1,
            "section": f"Rows {i+1}-{min(i+batch_size, len(data_rows))}",
            "chunk_index": chunk_idx,
            "doc_name": filename,
            "file_type": "csv"
        })
        chunk_idx += 1

    return chunks

def extract_text_chunks(content: bytes, filename: str, ext: str) -> List[Dict[str, Any]]:
    text = content.decode("utf-8", errors="replace")
    lines = text.split("\n")
    chunks = []
    current_section = "General"
    buffer = []
    buf_len = 0
    chunk_idx = 0

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            if buffer and buf_len > 250:
                chunks.append({
                    "text": "\n".join(buffer),
                    "page_number": 1,
                    "section": current_section,
                    "chunk_index": chunk_idx,
                    "doc_name": filename,
                    "file_type": ext
                })
                chunk_idx += 1
                buffer = []
                buf_len = 0
            current_section = stripped.lstrip("#").strip() or "Section"
            continue

        buffer.append(line)
        buf_len += len(line) + 1
        if buf_len >= 900:
            chunks.append({
                "text": "\n".join(buffer),
                "page_number": 1,
                "section": current_section,
                "chunk_index": chunk_idx,
                "doc_name": filename,
                "file_type": ext
            })
            chunk_idx += 1
            buffer = buffer[-2:] if len(buffer) >= 2 else []
            buf_len = sum(len(b) for b in buffer)

    if buffer and any(b.strip() for b in buffer):
        chunks.append({
            "text": "\n".join(buffer),
            "page_number": 1,
            "section": current_section,
            "chunk_index": chunk_idx,
            "doc_name": filename,
            "file_type": ext
        })

    return chunks


# Vector Store Implementation
class VectorStore:
    def __init__(self, persist_directory=None):
        if persist_directory is None:
            backend_db = os.path.join(BASE_DIR, "chroma_db")
            root_db = os.path.join(PROJECT_ROOT, "chroma_db")
            persist_directory = backend_db if os.path.exists(backend_db) else (root_db if os.path.exists(root_db) else backend_db)
        self.persist_directory = persist_directory
        self.client = None
        self.collection = None
        self.load()

    def load(self):
        try:
            self.client = chromadb.PersistentClient(
                path=self.persist_directory,
                settings=ChromaSettings(anonymized_telemetry=False)
            )
            self.collection = self.client.get_or_create_collection(
                name="rag_documents",
                metadata={"hnsw:space": "cosine"}
            )
            logger.info(f"Initialized ChromaDB persistent client at '{self.persist_directory}' with collection 'rag_documents'.")
        except Exception as e:
            logger.error(f"Error loading ChromaDB: {e}")
            raise e

    @property
    def documents(self) -> Dict[str, Dict[str, Any]]:
        try:
            results = self.collection.get(include=["metadatas"])
            docs = {}
            if results and results.get("metadatas"):
                for meta in results["metadatas"]:
                    if not meta:
                        continue
                    doc_name = meta.get("doc_name")
                    added_at = meta.get("added_at", "")
                    page_number = int(meta.get("page_number", 1))
                    file_type = meta.get("file_type", "")
                    if doc_name:
                        if doc_name not in docs:
                            docs[doc_name] = {
                                "chunks_count": 0,
                                "added_at": added_at,
                                "file_type": file_type,
                                "pages_count": 1
                            }
                        docs[doc_name]["chunks_count"] += 1
                        if page_number > docs[doc_name]["pages_count"]:
                            docs[doc_name]["pages_count"] = page_number
            return docs
        except Exception as e:
            logger.error(f"Error retrieving documents list from ChromaDB: {e}")
            return {}

    def get_document_chunks(self, doc_name: str) -> List[Dict[str, Any]]:
        try:
            results = self.collection.get(
                where={"doc_name": doc_name},
                include=["documents", "metadatas"]
            )
            chunks = []
            if results and results.get("documents"):
                docs = results["documents"]
                metas = results["metadatas"]
                for i in range(len(docs)):
                    meta = metas[i] if metas else {}
                    chunks.append({
                        "text": docs[i],
                        "page_number": meta.get("page_number", 1),
                        "section": meta.get("section", ""),
                        "chunk_index": meta.get("chunk_index", i)
                    })
            chunks.sort(key=lambda c: c["chunk_index"])
            return chunks
        except Exception as e:
            logger.error(f"Error retrieving chunks for {doc_name}: {e}")
            return []

    def add_document(self, doc_name: str, chunks: List[Dict[str, Any]], embeddings: List[List[float]]):
        self.delete_document(doc_name)
        added_at = datetime.now().isoformat()
        
        texts = [c["text"] for c in chunks]
        ids = [f"{doc_name}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "doc_name": doc_name,
                "added_at": added_at,
                "page_number": int(c.get("page_number", 1)),
                "section": str(c.get("section", "")),
                "chunk_index": int(c.get("chunk_index", i)),
                "file_type": str(c.get("file_type", "txt"))
            }
            for i, c in enumerate(chunks)
        ]

        try:
            batch_size = 200
            for i in range(0, len(texts), batch_size):
                self.collection.add(
                    ids=ids[i:i + batch_size],
                    embeddings=embeddings[i:i + batch_size],
                    documents=texts[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size]
                )
            logger.info(f"Added document '{doc_name}' ({len(texts)} chunks) with rich metadata to ChromaDB.")
        except Exception as e:
            logger.error(f"Error adding document to ChromaDB: {e}")
            raise e

    def delete_document(self, doc_name: str) -> bool:
        try:
            existing = self.collection.get(where={"doc_name": doc_name}, limit=1)
            has_chunks = bool(existing and existing.get("ids") and len(existing["ids"]) > 0)
            if has_chunks or doc_name in self.documents:
                self.collection.delete(where={"doc_name": doc_name})
                logger.info(f"Deleted document '{doc_name}' from ChromaDB.")
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting document from ChromaDB: {e}")
            return False

    def clear(self):
        try:
            self.client.delete_collection("rag_documents")
            self.collection = self.client.get_or_create_collection(
                name="rag_documents",
                metadata={"hnsw:space": "cosine"}
            )
            logger.info("Cleared all collections from ChromaDB.")
        except Exception as e:
            logger.error(f"Error clearing ChromaDB: {e}")

    def search(
        self,
        query_emb: List[float],
        top_k: int = 5,
        doc_filter: Optional[List[str]] = None,
        min_score: float = 0.25
    ) -> List[Dict[str, Any]]:
        try:
            where_clause = None
            if doc_filter:
                if len(doc_filter) == 1:
                    where_clause = {"doc_name": doc_filter[0]}
                else:
                    where_clause = {"doc_name": {"$in": doc_filter}}

            query_kwargs = {
                "query_embeddings": [query_emb],
                "n_results": min(top_k * 2, 20)  # fetch more candidates to filter by score
            }
            if where_clause:
                query_kwargs["where"] = where_clause

            results = self.collection.query(**query_kwargs)

            formatted_results = []
            if results and results.get("documents"):
                documents = results["documents"][0]
                metadatas = results["metadatas"][0]
                distances = results["distances"][0] if "distances" in results else None

                for i in range(len(documents)):
                    meta = metadatas[i] if metadatas and metadatas[i] else {}
                    doc_name = meta.get("doc_name", "Unknown")
                    page_number = meta.get("page_number", 1)
                    section = meta.get("section", "")
                    text = documents[i]
                    distance = distances[i] if distances is not None else 0.0
                    score = 1.0 - distance

                    if score >= min_score:
                        formatted_results.append({
                            "doc_name": doc_name,
                            "page_number": page_number,
                            "section": section,
                            "text": text,
                            "score": round(score, 3)
                        })

                # Sort by score descending and keep top_k
                formatted_results.sort(key=lambda r: r["score"], reverse=True)
                return formatted_results[:top_k]

            return []
        except Exception as e:
            logger.error(f"Error querying ChromaDB: {e}")
            return []

vector_store = VectorStore()


# Gemini Helper Functions
def get_api_key(x_gemini_api_key: Optional[str] = Header(None)) -> str:
    if x_gemini_api_key and x_gemini_api_key.strip():
        return x_gemini_api_key.strip()
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key and api_key.strip():
        return api_key.strip()
    raise HTTPException(
        status_code=401,
        detail="Gemini API Key is missing. Set it in Settings or create a .env file."
    )

def require_management_key(x_gemini_api_key: Optional[str] = Header(None)) -> str:
    """Helper for document management key; accepts server .env key or client key."""
    configured_key = os.getenv("GEMINI_API_KEY")
    if configured_key and configured_key.strip():
        return configured_key.strip()
    if x_gemini_api_key and x_gemini_api_key.strip():
        return x_gemini_api_key.strip()
    return ""

def generate_embeddings(texts: List[str], api_key: str, is_query: bool = False) -> List[List[float]]:
    try:
        genai.configure(api_key=api_key)
        task_type = "retrieval_query" if is_query else "retrieval_document"
        
        embeddings = []
        import time
        import re

        max_batch_chunks = 16
        i = 0
        total_chunks = len(texts)

        while i < total_chunks:
            batch = []
            batch_char_count = 0

            while i < total_chunks and len(batch) < max_batch_chunks:
                chunk_len = len(texts[i])
                if batch and (batch_char_count + chunk_len > 9000):
                    break
                batch.append(texts[i])
                batch_char_count += chunk_len
                i += 1

            max_retries = 4
            base_delay = 1.5
            for attempt in range(max_retries):
                try:
                    result = genai.embed_content(
                        model=EMBEDDING_MODEL,
                        content=batch,
                        task_type=task_type
                    )
                    embeddings.extend(result['embedding'])
                    if not is_query and i < total_chunks:
                        time.sleep(0.15)
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    is_rate_limit = "429" in err_str or "resourceexhausted" in err_str or "quota" in err_str
                    if is_rate_limit and attempt < max_retries - 1:
                        match = re.search(r"retry in (\d+\.?\d*)s", err_str)
                        sleep_time = float(match.group(1)) + 1.0 if match else base_delay * (2 ** attempt)
                        logger.warning(f"Rate limit hit. Retrying batch in {sleep_time:.1f}s (Attempt {attempt+1}/{max_retries})")
                        time.sleep(sleep_time)
                    else:
                        raise e

        return embeddings
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini API Embedding Error: {str(e)}")


def build_system_prompt(persona: str, context_str: str) -> str:
    persona_instructions = {
        "concise": "Provide clear, concise, and direct answers in bullet points. Highlight the key facts directly without conversational filler.",
        "deep": "Provide an in-depth, rigorous analysis. Cross-reference points, explore nuances, and provide detailed explanations supported by the text.",
        "executive": "Format your response as an executive briefing: High-Level Takeaway, Key Strategic Points, and Action Items.",
        "technical": "Provide precise technical details, specifications, formulas, or code snippets where applicable.",
        "standard": "Answer truthfully and comprehensively using clear, structured Markdown with headings and bullet points."
    }

    style_guide = persona_instructions.get(persona.lower(), persona_instructions["standard"])

    return (
        f"You are RAG - Chatbot, an intelligent and grounded RAG AI Assistant.\n"
        f"Style Directive: {style_guide}\n\n"
        "CORE RULES:\n"
        "1. Base your answer ONLY on the provided Context below.\n"
        "2. If the answer cannot be found in the Context or no documents are present, state clearly and politely that you don't have enough information from the uploaded documents.\n"
        "3. DO NOT fabricate facts or assumptions not directly supported by the text.\n"
        "4. Whenever citing facts, include citations in the format [Source N] (e.g. [Source 1], [Source 2]).\n"
        "5. Keep the formatting clean and readable using GitHub-flavored markdown.\n\n"
        f"--- CONTEXT FROM DOCUMENTS ---\n{context_str}\n--- END CONTEXT ---"
    )


# Document Store for Full Clean Document Preview
DOC_STORE_DIR = os.path.join(BASE_DIR, "document_store")
if not os.path.exists(DOC_STORE_DIR) and os.path.exists(os.path.join(PROJECT_ROOT, "document_store")):
    DOC_STORE_DIR = os.path.join(PROJECT_ROOT, "document_store")

DOC_FILES_DIR = os.path.join(DOC_STORE_DIR, "files")
DOC_PARSED_DIR = os.path.join(DOC_STORE_DIR, "parsed")
os.makedirs(DOC_FILES_DIR, exist_ok=True)
os.makedirs(DOC_PARSED_DIR, exist_ok=True)

import re

def save_parsed_document(doc_name: str, file_type: str, pages_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    full_text = "\n\n".join(p.get("text", "") for p in pages_data)
    data = {
        "doc_name": doc_name,
        "file_type": file_type,
        "total_pages": len(pages_data),
        "pages": pages_data,
        "full_text": full_text
    }
    json_path = os.path.join(DOC_PARSED_DIR, f"{doc_name}.json")
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving parsed doc {doc_name}: {e}")
    return data

def get_parsed_document(doc_name: str) -> Optional[Dict[str, Any]]:
    json_path = os.path.join(DOC_PARSED_DIR, f"{doc_name}.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading parsed doc {doc_name}: {e}")

    # Fallback: check if raw file exists
    raw_path = os.path.join(DOC_FILES_DIR, doc_name)
    if os.path.exists(raw_path):
        try:
            with open(raw_path, "rb") as f:
                content = f.read()
            lower = doc_name.lower()
            if lower.endswith(".pdf"):
                pages = []
                reader = PdfReader(io.BytesIO(content))
                for page_idx, page in enumerate(reader.pages, start=1):
                    p_raw = page.extract_text() or ""
                    paras = [p.strip() for p in re.split(r'\n\s*\n', p_raw) if p.strip()]
                    clean_paras = [" ".join(l.strip() for l in p.split('\n') if l.strip()) for p in paras if p]
                    pages.append({"page_number": page_idx, "paragraphs": clean_paras, "text": "\n\n".join(clean_paras)})
                return save_parsed_document(doc_name, "pdf", pages)
        except Exception as e:
            logger.error(f"Error parsing raw file {doc_name}: {e}")

    # Fallback: reconstruct from ChromaDB chunks
    chunks = vector_store.get_document_chunks(doc_name)
    if not chunks:
        return None

    # Group by page number or stitch
    pages_map = {}
    for c in chunks:
        pnum = c.get("page_number", 1)
        pages_map.setdefault(pnum, []).append(c)

    pages_data = []
    if len(pages_map) == 1 and 1 in pages_map:
        full_text = chunks[0]["text"]
        for i in range(1, len(chunks)):
            nxt = chunks[i]["text"]
            merged = False
            for k in range(min(len(full_text), len(nxt), 400), 15, -1):
                if full_text.endswith(nxt[:k]):
                    full_text += nxt[k:]
                    merged = True
                    break
            if not merged:
                full_text += "\n\n" + nxt

        page_splits = re.split(r'(Page\s+\d+\s+of\s+\d+)', full_text, flags=re.IGNORECASE)
        current_page_num = 1
        page_contents = {1: []}
        i = 0
        while i < len(page_splits):
            part = page_splits[i].strip()
            match = re.match(r'Page\s+(\d+)\s+of\s+(\d+)', part, flags=re.IGNORECASE)
            if match:
                current_page_num = int(match.group(1))
                page_contents.setdefault(current_page_num, []).append(part)
            else:
                if part:
                    page_contents.setdefault(current_page_num, []).append(part)
            i += 1

        for pnum in sorted(page_contents.keys()):
            p_text = "\n\n".join(page_contents[pnum])
            raw_paras = [p.strip() for p in re.split(r'\n\s*\n', p_text) if p.strip()]
            clean_paras = [" ".join(l.strip() for l in p.split('\n') if l.strip()) for p in raw_paras if p]
            pages_data.append({
                "page_number": pnum,
                "paragraphs": clean_paras,
                "text": "\n\n".join(clean_paras)
            })
    else:
        for pnum in sorted(pages_map.keys()):
            p_text = "\n\n".join(c["text"] for c in pages_map[pnum])
            raw_paras = [p.strip() for p in re.split(r'\n\s*\n', p_text) if p.strip()]
            clean_paras = [" ".join(l.strip() for l in p.split('\n') if l.strip()) for p in raw_paras if p]
            pages_data.append({
                "page_number": pnum,
                "paragraphs": clean_paras,
                "text": "\n\n".join(clean_paras)
            })

    return save_parsed_document(doc_name, "doc", pages_data)


# API Endpoints

@app.get("/api/health")
def health_check():
    """Health check endpoint for Docker container probes and load balancers."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.get("/api/check-key")
def check_key():
    """Checks if a Gemini API Key is configured and returns available models."""
    has_key = bool(os.getenv("GEMINI_API_KEY"))
    return {
        "configured": has_key,
        "default_model": DEFAULT_MODEL,
        "available_models": [
            {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash (Fast & Modern)"},
            {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash"},
            {"id": "gemini-flash-latest", "name": "Gemini Flash Latest"}
        ]
    }

@app.get("/api/documents")
def list_documents():
    """Returns lists of currently uploaded files with rich metadata."""
    return [
        {
            "name": name,
            "chunks_count": info["chunks_count"],
            "added_at": info["added_at"],
            "file_type": info.get("file_type", "txt"),
            "pages_count": info.get("pages_count", 1)
        }
        for name, info in vector_store.documents.items()
    ]

@app.get("/api/documents/{doc_name:path}/preview")
def preview_document(doc_name: str):
    """Returns real structured pages, paragraphs, and content of a document."""
    doc_data = get_parsed_document(doc_name)
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found or has no content")
    return doc_data

@app.delete("/api/documents/{doc_name:path}")
def delete_document(doc_name: str, x_gemini_api_key: Optional[str] = Header(None)):
    """Deletes a document from the index and cache."""
    deleted_chroma = vector_store.delete_document(doc_name)

    # Also clean up parsed and raw cache files if present
    raw_path = os.path.join(DOC_FILES_DIR, doc_name)
    json_path = os.path.join(DOC_PARSED_DIR, f"{doc_name}.json")
    deleted_file = False
    for p in [raw_path, json_path]:
        if os.path.exists(p):
            try:
                os.remove(p)
                deleted_file = True
            except Exception as e:
                logger.warning(f"Failed to remove cached file {p}: {e}")

    if not deleted_chroma and not deleted_file:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": f"Successfully deleted document '{doc_name}'"}

@app.delete("/api/clear")
def clear_store(x_gemini_api_key: Optional[str] = Header(None)):
    """Clears all indexed documents and local caches."""
    vector_store.clear()
    for folder in [DOC_FILES_DIR, DOC_PARSED_DIR]:
        if os.path.exists(folder):
            for fname in os.listdir(folder):
                fpath = os.path.join(folder, fname)
                try:
                    if os.path.isfile(fpath):
                        os.remove(fpath)
                except Exception:
                    pass
    return {"message": "All documents and embeddings cleared successfully."}

@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    x_gemini_api_key: Optional[str] = Header(None)
):
    """Upload PDF, DOCX, CSV, TXT, MD, JSON or Code documents, chunk them, embed them, and index them."""
    api_key = get_api_key(x_gemini_api_key)
    processed_files = []

    for file in files:
        filename = file.filename or "unnamed-file"
        lower_name = filename.lower()
        logger.info(f"Processing uploaded file: {filename}")

        content = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
        if len(content) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File {filename} is too large. Maximum size is {MAX_UPLOAD_SIZE_MB} MB."
            )

        chunks: List[Dict[str, Any]] = []

        try:
            if lower_name.endswith(".pdf"):
                chunks = extract_pdf_chunks(content, filename)
            elif lower_name.endswith((".docx", ".doc")):
                chunks = extract_docx_chunks(content, filename)
            elif lower_name.endswith(".csv"):
                chunks = extract_csv_chunks(content, filename)
            elif lower_name.endswith((".txt", ".md", ".json", ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".yaml", ".yml")):
                ext = lower_name.split(".")[-1]
                chunks = extract_text_chunks(content, filename, ext)
            else:
                # Attempt general text decode
                try:
                    chunks = extract_text_chunks(content, filename, "txt")
                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported file format for {filename}. Supported: PDF, DOCX, CSV, TXT, MD, JSON, Code."
                    )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error parsing file {filename}: {e}")
            raise HTTPException(status_code=500, detail=f"Error parsing {filename}: {str(e)}")

        if not chunks:
            raise HTTPException(
                status_code=400,
                detail=f"File {filename} is empty or no readable text was extracted."
            )

        logger.info(f"Generated {len(chunks)} smart chunks for {filename}.")
        texts = [c["text"] for c in chunks]
        embeddings = generate_embeddings(texts, api_key, is_query=False)
        vector_store.add_document(filename, chunks, embeddings)

        pages = max([c.get("page_number", 1) for c in chunks], default=1)
        processed_files.append({
            "filename": filename,
            "chunks": len(chunks),
            "pages": pages,
            "type": chunks[0].get("file_type", "txt")
        })

    return {
        "message": f"Successfully processed {len(processed_files)} file(s).",
        "files": processed_files
    }

@app.post("/api/chat")
def chat(
    message: str = Body(..., embed=True),
    history: List[Dict[str, str]] = Body(default=[], embed=True),
    persona: str = Body(default="standard", embed=True),
    doc_filter: Optional[List[str]] = Body(default=None, embed=True),
    model_name: Optional[str] = Body(default=None, embed=True),
    x_gemini_api_key: Optional[str] = Header(None)
):
    """Synchronous grounded answer retrieval."""
    api_key = get_api_key(x_gemini_api_key)
    active_model = model_name or DEFAULT_MODEL

    query_emb = generate_embeddings([message], api_key, is_query=True)[0]
    top_matches = vector_store.search(query_emb, top_k=5, doc_filter=doc_filter)

    context_parts = []
    for i, match in enumerate(top_matches):
        page_info = f" (Page {match['page_number']})" if match.get("page_number", 1) > 1 else ""
        section_info = f" [{match['section']}]" if match.get("section") and match['section'] != f"Page {match.get('page_number', 1)}" else ""
        context_parts.append(
            f"[Source {i+1}]: {match['doc_name']}{page_info}{section_info} (Match: {int(match['score']*100)}%)\n"
            f"Content: {match['text']}"
        )

    context_str = "\n\n".join(context_parts) if context_parts else "No relevant context found in documents."
    system_instruction = build_system_prompt(persona, context_str)

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=active_model,
            system_instruction=system_instruction
        )

        chat_history = []
        for h in history:
            role = "user" if h["role"] in ["user", "human"] else "model"
            chat_history.append({"role": role, "parts": [h["content"]]})

        chat_session = model.start_chat(history=chat_history)
        response = chat_session.send_message(message)

        # Generate 2-3 quick follow-up questions
        follow_ups = []
        try:
            suggest_prompt = (
                f"Based on this question: '{message}' and answer: '{response.text[:300]}', "
                "give exactly 3 short follow-up questions a user might ask next. "
                "Format as a JSON array of strings only, like [\"Question 1?\", \"Question 2?\", \"Question 3?\"]."
            )
            sugg_model = genai.GenerativeModel("gemini-3.8-flash")
            sugg_res = sugg_model.generate_content(suggest_prompt)
            clean_json = sugg_res.text.strip().lstrip("```json").rstrip("```").strip()
            follow_ups = json.loads(clean_json)
        except Exception:
            follow_ups = []

        return {
            "reply": response.text,
            "sources": top_matches,
            "follow_ups": follow_ups[:3]
        }
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        raise HTTPException(status_code=500, detail=f"Generation Error: {str(e)}")


@app.post("/api/chat/stream")
def chat_stream(
    message: str = Body(..., embed=True),
    history: List[Dict[str, str]] = Body(default=[], embed=True),
    persona: str = Body(default="standard", embed=True),
    doc_filter: Optional[List[str]] = Body(default=None, embed=True),
    model_name: Optional[str] = Body(default=None, embed=True),
    x_gemini_api_key: Optional[str] = Header(None)
):
    """Server-Sent Events (SSE) streaming endpoint for real-time interactive answers."""
    api_key = get_api_key(x_gemini_api_key)
    active_model = model_name or DEFAULT_MODEL

    def event_generator():
        try:
            # 1. Status: Embedding & Retrieving
            yield f"event: status\ndata: {json.dumps({'step': 'retrieving', 'message': 'Searching knowledge base for relevant passages...'})}\n\n"

            query_emb = generate_embeddings([message], api_key, is_query=True)[0]
            top_matches = vector_store.search(query_emb, top_k=5, doc_filter=doc_filter)

            # 2. Status: Sources identified & analyzing
            yield f"event: sources\ndata: {json.dumps({'sources': top_matches})}\n\n"

            doc_names = list(dict.fromkeys(m['doc_name'] for m in top_matches))
            if doc_names:
                doc_summary = f"{len(top_matches)} passages from {doc_names[0]}" if len(doc_names) == 1 else f"{len(top_matches)} passages across {len(doc_names)} documents"
                yield f"event: status\ndata: {json.dumps({'step': 'analyzing', 'message': f'Analyzing & extracting context from {doc_summary}...'})}\n\n"
            else:
                yield f"event: status\ndata: {json.dumps({'step': 'analyzing', 'message': 'Analyzing indexed context...'})}\n\n"

            context_parts = []
            for i, match in enumerate(top_matches):
                page_info = f" (Page {match['page_number']})" if match.get("page_number", 1) > 1 else ""
                section_info = f" [{match['section']}]" if match.get("section") and match['section'] != f"Page {match.get('page_number', 1)}" else ""
                context_parts.append(
                    f"[Source {i+1}]: {match['doc_name']}{page_info}{section_info} (Match: {int(match['score']*100)}%)\n"
                    f"Content: {match['text']}"
                )

            context_str = "\n\n".join(context_parts) if context_parts else "No relevant context found in documents."
            system_instruction = build_system_prompt(persona, context_str)

            # 3. Status: Synthesizing
            yield f"event: status\ndata: {json.dumps({'step': 'generating', 'message': 'Extracting key facts and synthesizing grounded answer...'})}\n\n"

            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(
                model_name=active_model,
                system_instruction=system_instruction
            )

            chat_history = []
            for h in history:
                role = "user" if h["role"] in ["user", "human"] else "model"
                chat_history.append({"role": role, "parts": [h["content"]]})

            chat_session = model.start_chat(history=chat_history)
            stream_response = chat_session.send_message(message, stream=True)

            full_reply_text = ""
            for chunk in stream_response:
                chunk_text = chunk.text
                if chunk_text:
                    full_reply_text += chunk_text
                    yield f"event: delta\ndata: {json.dumps({'delta': chunk_text})}\n\n"

            # 4. Generate dynamic follow-up suggestions
            follow_ups = []
            try:
                suggest_prompt = (
                    f"Based on this question: '{message}' and answer: '{full_reply_text[:300]}', "
                    "give exactly 3 short relevant follow-up questions a user might ask next. "
                    "Format as a JSON array of strings only, e.g. [\"Q1?\", \"Q2?\", \"Q3?\"]."
                )
                sugg_model = genai.GenerativeModel("gemini-3.8-flash")
                sugg_res = sugg_model.generate_content(suggest_prompt)
                clean_json = sugg_res.text.strip().lstrip("```json").rstrip("```").strip()
                follow_ups = json.loads(clean_json)
            except Exception:
                pass

            if follow_ups:
                yield f"event: suggestions\ndata: {json.dumps({'suggestions': follow_ups[:3]})}\n\n"

            # 5. Final event
            yield f"event: done\ndata: {json.dumps({'reply': full_reply_text, 'sources': top_matches})}\n\n"

        except Exception as e:
            logger.error(f"Error in SSE stream: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# Mount static files (look in backend/static, then project root static/)
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    static_dir = os.path.join(PROJECT_ROOT, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0" if os.getenv("PORT") else "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=False)
