"""
Root launcher for Atlas RAG Backend.
Allows running `python run.py` directly from the project root.
"""
import os
import sys

if __name__ == "__main__":
    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    sys.path.insert(0, backend_dir)
    os.chdir(backend_dir)
    
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0" if os.getenv("PORT") else "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=False)
