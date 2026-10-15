# Fullstack AI interview: starter projects

Each folder is a self-contained starter project for one interview problem. Your interviewer will tell you which one to open.

| Folder | Problem |
| --- | --- |
| [`claims-autocomplete/`](claims-autocomplete) | Approved-claims autocomplete |
| [`collab-editor/`](collab-editor) | Collaborative editor with an AI co-editor |
| [`object-storage/`](object-storage) | Versioned object storage (S3-style) |

## Getting started

Requires Node 22 or newer. Open in GitHub Codespaces, or clone and run locally:

```bash
cd <folder>
npm install
npm test          # runs the test suite
```

Each folder's README explains what is provided, what you implement, and how to run the app.

## Run with Docker

Each folder has its own `docker-compose.yml`. From the folder:

```bash
cd claims-autocomplete && docker compose up   # http://localhost:5173
cd collab-editor && docker compose up         # http://localhost:5174
cd object-storage && docker compose up        # http://localhost:5175
```

From the repo root, `docker compose up <folder>` does the same.

Each project uses a built-in fake AI by default. To use a real model, copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. Tests always use the fakes.

AI tools are welcome while you build. Read, run and question what they write: in the debrief we'll ask you to walk through your code.
