import io
import os
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Body
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader
import numpy as np
import chromadb
from dotenv import load_dotenv
import google.generativeai as genai

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI(title="RAG Chatbot Backend")

# Enable CORS for development convenience
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Text Splitter Function
def split_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> List[str]:
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        if end >= text_len:
            chunks.append(text[start:])
            break
        
        # Try to find a reasonable split point near the end of the chunk
        split_point = text.rfind('\n', start + chunk_size - 120, end)
        if split_point == -1:
            split_point = text.rfind(' ', start + chunk_size - 120, end)
        
        if split_point != -1 and split_point > start:
            chunks.append(text[start:split_point].strip())
            start = split_point - chunk_overlap
        else:
            chunks.append(text[start:end].strip())
            start = end - chunk_overlap
            
    return [c for c in chunks if c]

# Vector Store Implementation
class VectorStore:
    def __init__(self, persist_directory="chroma_db"):
        self.persist_directory = persist_directory
        self.client = None
        self.collection = None
        self.load()

    def load(self):
        try:
            self.client = chromadb.PersistentClient(path=self.persist_directory)
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
                    if doc_name:
                        if doc_name not in docs:
                            docs[doc_name] = {"chunks_count": 0, "added_at": added_at}
                        docs[doc_name]["chunks_count"] += 1
            return docs
        except Exception as e:
            logger.error(f"Error retrieving documents list from ChromaDB: {e}")
            return {}

    def add_document(self, doc_name: str, texts: List[str], embeddings: List[List[float]]):
        self.delete_document(doc_name)
        
        from datetime import datetime
        added_at = datetime.now().isoformat()
        
        ids = [f"{doc_name}_chunk_{i}" for i in range(len(texts))]
        metadatas = [{"doc_name": doc_name, "added_at": added_at} for _ in range(len(texts))]
        
        try:
            # Batch additions into ChromaDB to avoid exceeding max batch size
            batch_size = 250
            for i in range(0, len(texts), batch_size):
                self.collection.add(
                    ids=ids[i:i + batch_size],
                    embeddings=embeddings[i:i + batch_size],
                    documents=texts[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size]
                )
            logger.info(f"Added document '{doc_name}' with {len(texts)} chunks to ChromaDB in batches of {batch_size}.")
        except TypeError as te:
            # Self-healing fallback if ChromaDB's SQLite seq_id hits integer/bytes decoding mismatch
            logger.warning(f"ChromaDB internal seq_id mismatch ({te}). Clearing and re-initializing collection...")
            self.clear()
            batch_size = 250
            for i in range(0, len(texts), batch_size):
                self.collection.add(
                    ids=ids[i:i + batch_size],
                    embeddings=embeddings[i:i + batch_size],
                    documents=texts[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size]
                )
            logger.info(f"Successfully re-added document '{doc_name}' after resetting ChromaDB collection.")
        except Exception as e:
            logger.error(f"Error adding document to ChromaDB: {e}")
            raise e

    def delete_document(self, doc_name: str) -> bool:
        try:
            if doc_name in self.documents:
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

    def search(self, query_emb: List[float], top_k: int = 5) -> List[Dict[str, Any]]:
        try:
            results = self.collection.query(
                query_embeddings=[query_emb],
                n_results=top_k
            )
            
            formatted_results = []
            if results and results.get("documents"):
                documents = results["documents"][0]
                metadatas = results["metadatas"][0]
                distances = results["distances"][0] if "distances" in results else None
                
                for i in range(len(documents)):
                    doc_name = metadatas[i].get("doc_name", "Unknown") if metadatas[i] else "Unknown"
                    text = documents[i]
                    # Cosine distance in Chroma = 1 - cosine_similarity.
                    # Therefore, score (cosine_similarity) = 1 - distance.
                    distance = distances[i] if distances is not None else 0.0
                    score = 1.0 - distance
                    
                    formatted_results.append({
                        "doc_name": doc_name,
                        "text": text,
                        "score": score
                    })
            return formatted_results
        except Exception as e:
            logger.error(f"Error querying ChromaDB: {e}")
            return []

# Instantiate Vector Store
vector_store = VectorStore()

# Gemini Helper Functions
def get_api_key(x_gemini_api_key: Optional[str] = Header(None)) -> str:
    if x_gemini_api_key:
        return x_gemini_api_key
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        return api_key
    raise HTTPException(
        status_code=401,
        detail="Gemini API Key is missing. Set it in the UI settings or create a .env file."
    )

def generate_embeddings(texts: List[str], api_key: str, is_query: bool = False) -> List[List[float]]:
    try:
        genai.configure(api_key=api_key)
        task_type = "retrieval_query" if is_query else "retrieval_document"
        
        embeddings = []
        import time
        import re
        
        # Dynamic batching: Max 16 chunks & max 10,000 chars per API call to stay within payload limits
        max_batch_chunks = 16
        i = 0
        total_chunks = len(texts)
        
        while i < total_chunks:
            batch = []
            batch_char_count = 0
            
            while i < total_chunks and len(batch) < max_batch_chunks:
                chunk_len = len(texts[i])
                if batch and (batch_char_count + chunk_len > 10000):
                    break
                batch.append(texts[i])
                batch_char_count += chunk_len
                i += 1
                
            # Retry loop for rate limits (429 / ResourceExhausted)
            max_retries = 5
            base_delay = 2.0
            for attempt in range(max_retries):
                try:
                    result = genai.embed_content(
                        model="models/gemini-embedding-001",
                        content=batch,
                        task_type=task_type
                    )
                    embeddings.extend(result['embedding'])
                    if not is_query and i < total_chunks:
                        time.sleep(0.3)
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    is_rate_limit = "429" in err_str or "resourceexhausted" in err_str or "quota" in err_str
                    if is_rate_limit and attempt < max_retries - 1:
                        match = re.search(r"retry in (\d+\.?\d*)s", err_str)
                        if match:
                            sleep_time = float(match.group(1)) + 1.5
                        else:
                            sleep_time = base_delay * (2 ** attempt)
                        
                        logger.warning(f"Gemini API rate limit hit. Retrying embedding batch in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                        time.sleep(sleep_time)
                    else:
                        raise e
        return embeddings
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini API Embedding Error: {str(e)}")

# API Endpoints

@app.get("/api/check-key")
def check_key():
    """Checks if a Gemini API Key is configured in the environment."""
    has_key = bool(os.getenv("GEMINI_API_KEY"))
    return {"configured": has_key}

@app.get("/api/documents")
def list_documents():
    """Returns lists of currently uploaded files."""
    return [
        {
            "name": name,
            "chunks_count": info["chunks_count"],
            "added_at": info["added_at"]
        }
        for name, info in vector_store.documents.items()
    ]

@app.delete("/api/documents/{doc_name:path}")
def delete_document(doc_name: str):
    """Deletes a document from the index."""
    deleted = vector_store.delete_document(doc_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": f"Successfully deleted document '{doc_name}'"}

@app.delete("/api/clear")
def clear_store():
    """Clears all indexed documents."""
    vector_store.clear()
    return {"message": "All documents and embeddings cleared successfully."}

@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    x_gemini_api_key: Optional[str] = Header(None)
):
    """Upload documents, chunk them, embed them, and index them."""
    api_key = get_api_key(x_gemini_api_key)
    processed_files = []
    
    for file in files:
        filename = file.filename
        logger.info(f"Processing uploaded file: {filename}")
        
        content = await file.read()
        text = ""
        
        try:
            if filename.lower().endswith(".pdf"):
                pdf_reader = PdfReader(io.BytesIO(content))
                pages_text = []
                for i, page in enumerate(pdf_reader.pages):
                    try:
                        page_text = page.extract_text() or ""
                        pages_text.append(page_text)
                    except Exception as pe:
                        logger.warning(f"Skipping unreadable page {i+1} in {filename}: {pe}")
                text = "\n\n".join(pages_text)
            elif filename.lower().endswith((".txt", ".md")):
                text = content.decode("utf-8", errors="replace")
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file format for {filename}. Please upload PDF, TXT or MD files."
                )
        except Exception as e:
            logger.error(f"Error parsing file {filename}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Error parsing file {filename}: {str(e)}"
            )

        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail=f"File {filename} is empty or no readable text was extracted."
            )
            
        chunks = split_text(text)
        logger.info(f"Split {filename} into {len(chunks)} chunks.")
        
        # Get embeddings
        embeddings = generate_embeddings(chunks, api_key, is_query=False)
        
        # Save to store
        vector_store.add_document(filename, chunks, embeddings)
        processed_files.append({"filename": filename, "chunks": len(chunks)})

    return {
        "message": f"Successfully processed {len(processed_files)} file(s).",
        "files": processed_files
    }

@app.post("/api/chat")
def chat(
    message: str = Body(..., embed=True),
    history: List[Dict[str, str]] = Body(default=[], embed=True),
    x_gemini_api_key: Optional[str] = Header(None)
):
    """Answers user queries grounded in retrieved documents."""
    api_key = get_api_key(x_gemini_api_key)
    
    # 1. Embed query
    query_emb = generate_embeddings([message], api_key, is_query=True)[0]
    
    # 2. Retrieve contexts
    top_matches = vector_store.search(query_emb, top_k=5)
    
    # 3. Assemble prompt context
    context_str = ""
    if top_matches:
        context_parts = []
        for i, match in enumerate(top_matches):
            context_parts.append(
                f"[Source {i+1}]: {match['doc_name']} (Similarity: {match['score']:.2f})\n"
                f"Content: {match['text']}"
            )
        context_str = "\n\n".join(context_parts)
    else:
        context_str = "No relevant context found in documents."
        
    system_instruction = (
        "You are an expert RAG Assistant. Your job is to answer the user's questions truthfully and accurately "
        "using ONLY the provided Context from documents below. If the answer cannot be found in the Context "
        "or if there are no documents uploaded, state clearly that you don't know based on the provided documents. "
        "Do not make up facts. Always structure your response nicely and highlight citations using [Source N] tags when referencing facts.\n\n"
        f"--- CONTEXT ---\n{context_str}\n--- END CONTEXT ---"
    )
    
    # 4. Invoke LLM with conversation history
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-3.6-flash",
            system_instruction=system_instruction
        )
        
        # Convert history format to Google's expected format:
        # History roles must alternate: user, model
        chat_sessions_messages = []
        for h in history:
            role = "user" if h["role"] in ["user", "human"] else "model"
            chat_sessions_messages.append({"role": role, "parts": [h["content"]]})
            
        chat = model.start_chat(history=chat_sessions_messages)
        response = chat.send_message(message)
        
        return {
            "reply": response.text,
            "sources": [
                {
                    "doc_name": m["doc_name"],
                    "text": m["text"],
                    "score": m["score"]
                }
                for m in top_matches
            ]
        }
    except Exception as e:
        logger.error(f"Error invoking Gemini Model: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini Chat Generation Error: {str(e)}")

# Mount static files
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
