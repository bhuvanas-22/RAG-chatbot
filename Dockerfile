# ==============================================================================
# Multi-Stage Dockerfile for Atlas RAG Chatbot
# Designed to be simple, lightweight, and beginner-friendly.
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Build the React Frontend
# ------------------------------------------------------------------------------
# Use official Node.js runtime as builder
FROM node:20-slim AS frontend-builder

# Set working directory for frontend inside container
WORKDIR /app/frontend

# Copy package manifests first to leverage Docker layer caching
COPY frontend/package*.json ./

# Install Node dependencies (React, TypeScript, Vite, Lucide icons, etc.)
RUN npm install

# Copy frontend source code
COPY frontend/ ./

# Build production assets (outputs compiled HTML, JS, CSS into /app/static)
RUN npm run build


# ------------------------------------------------------------------------------
# STAGE 2: Python Backend & Production Runtime
# ------------------------------------------------------------------------------
# Use lightweight official Python runtime
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable real-time unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set root application directory
WORKDIR /app

# Install minimal build tools needed for C-extensions (e.g. ChromaDB) and curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy root Python dependencies file
COPY requirements.txt ./

# Install Python backend dependencies (FastAPI, ChromaDB, Google Gemini, etc.)
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code, root launcher script, and sample documents
COPY backend/ ./backend/
COPY run.py ./
COPY sample_docs/ ./sample_docs/

# Copy compiled frontend assets from STAGE 1 into /app/static
COPY --from=frontend-builder /app/static ./static/

# Pre-create writable directories for ChromaDB and document store
RUN mkdir -p /app/backend/chroma_db /app/backend/document_store

# ------------------------------------------------------------------------------
# Runtime Configuration & Port Binding
# ------------------------------------------------------------------------------
# Cloud platforms (Render, Railway, Heroku, Cloud Run) inject the PORT environment variable
ENV PORT=8000
ENV HOST=0.0.0.0

# Document exposed container port
EXPOSE 8000

# Container health check (verifies backend is alive and responding)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health || exit 1

# Start FastAPI backend with single-port static frontend serving
CMD ["python", "run.py"]
