# Server

Node.js/Express API wrapper that sits between the browser frontends and Stable Diffusion WebUI.

## Setup

```bash
cd server
cp .env.example .env
# edit .env with your values
npm install
node api.js
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SD_HOST` | yes | `http://localhost:7860` | SD WebUI address |
| `API_KEY` | yes | `change-me` | Secret key for all requests |
| `KOHYA_DIR` | no | `/workspace/kohya_ss` | Kohya SS install path |
| `WEBUI_DIR` | no | `/workspace/stable-diffusion-webui` | SD WebUI path |
| `GALLERY_DIR` | no | `/workspace/gallery` | Where gallery images are stored |
| `IDLE_MINUTES` | no | `30` | Shutdown pod after N min idle (0 = off) |
| `RUNPOD_API_KEY` | no | — | RunPod API key for auto-shutdown |
| `RUNPOD_POD_ID` | no | — | This pod's ID for auto-shutdown |
| `PORT` | no | `3000` | API server port |

## On RunPod

`start.sh` handles everything automatically:
1. Copies `api.js` from `/workspace/api.js`
2. Installs dependencies via `npm install`
3. Starts the server via `pm2` (auto-restarts on crash)

You don't run `node api.js` manually on the pod.

## Alternative: Python

`api.py` is a Python/FastAPI implementation with the same endpoints:

```bash
pip install fastapi uvicorn httpx python-dotenv
uvicorn api:app --host 0.0.0.0 --port 3000
```

## Architecture notes

- All image generation goes through an in-memory queue — only one job runs at a time
- Gallery images are stored as PNG files in `GALLERY_DIR` with a JSON index
- Training jobs run Kohya SS as a subprocess, progress is parsed from stdout
- Rate limiting: 60 req/min per IP (trusted clients with correct API key bypass this)
