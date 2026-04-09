# CLAUDE.md
# Project context for AI assistant sessions
# Keep this file updated as the project evolves

## Repository
- **GitHub:** https://github.com/magwerzyn-ux/comixbook
- **Name:** ComixBook

## Developer environment
- Working on a **laptop with no local dev environment installed**
- No local Node, Python, git CLI, or code editor
- All code editing happens via **GitHub web UI** or **GitHub Desktop**
- No local testing — changes are tested by deploying to RunPod

## Project overview
ComixBook is an AI-powered comic creation studio running on a RunPod GPU pod.

### What it does
- Generate comic panels with Stable Diffusion (txt2img, img2img, inpaint)
- Train character LoRAs using synthetic data (img2img variations as training set)
- Compose comic pages (panel layouts, speech bubbles, export)
- Browse generated images in a persistent gallery
- All runs in the browser — no local install needed by end users

### Stack
| Layer | Technology |
|---|---|
| GPU pod | RunPod (RTX 4090 recommended) |
| Image generation | Stable Diffusion WebUI (AUTOMATIC1111) |
| LoRA training | Kohya SS |
| API server | Node.js / Express (`server/api.js`) |
| Frontends | Vanilla HTML/JS (no framework, no build step) |
| File manager | JupyterLab (port 8888) |
| Persistent storage | RunPod network volume at `/workspace` |

## Repo structure
```
ComixBook/
├── CLAUDE.md                  ← you are here
├── README.md
├── CONTRIBUTING.md
├── .gitignore
│
├── frontend/
│   ├── comic-studio.html      Main app — script editor, composer, LoRA trainer, gallery
│   ├── studio.html            Advanced SD interface — ControlNet, IP-Adapter, presets
│   └── beginner.html          Simplified noob-friendly image generator
│
├── server/
│   ├── api.js                 Node.js/Express API wrapper (canonical)
│   ├── api.py                 Python/FastAPI alternative
│   ├── api-examples.js        Client usage examples
│   ├── package.json
│   └── .env.example
│
├── deploy/
│   ├── start.sh               RunPod pod startup script
│   └── runpod-template.json   RunPod template config reference
│
└── docs/
    └── deployment-guide.docx  Full setup guide
```

## RunPod deployment
- **Pod startup:** `bash /workspace/start.sh`
- **Ports exposed:** 7860 (SD WebUI), 3000 (API), 8888 (JupyterLab)
- **Network volume:** mounted at `/workspace` — persists between pod restarts
- `start.sh` auto-pulls from `magwerzyn-ux/comixbook` on boot if repo is cloned at `/workspace/ComixBook`

### Services on the pod
| Service | Port |
|---|---|
| SD WebUI | 7860 |
| API wrapper | 3000 |
| JupyterLab | 8888 |

### Required env vars (set in RunPod template)
| Variable | Purpose |
|---|---|
| `HF_TOKEN` | HuggingFace downloads |
| `CIVITAI_TOKEN` | CivitAI model downloads |
| `API_KEY` | API server auth key |
| `JUPYTER_PASSWORD` | JupyterLab login password |
| `IDLE_MINUTES` | Auto-shutdown after N min idle (default: 30) |
| `RUNPOD_API_KEY` | RunPod API key for auto-shutdown |
| `RUNPOD_POD_ID` | This pod's ID for auto-shutdown |

## API server (`server/api.js`)
- All imports at the top — ES module, no mid-file imports
- All generation goes through an in-memory queue (one job at a time)
- Gallery stored as PNG files + JSON index at `/workspace/gallery`
- Rate limiting: 60 req/min per IP, bypassed for correct API key
- Auto-saves every generated image to the gallery

### Key endpoints
- `POST /generate/txt2img` — text to image
- `POST /generate/img2img` — image to image
- `POST /inpaint` — inpaint masked region
- `GET /queue` — queue status
- `POST /train/lora` — start LoRA training (Kohya SS subprocess)
- `GET /gallery` — browse images
- `GET /idle` — idle timer status

## Models on the pod
- **epiCRealism Natural Sin RC1** (default, SD1.5, photorealistic)
- **Realistic Vision V6.0 B1** (SD1.5, photorealistic)
- **VAE:** vae-ft-mse-840000-ema-pruned
- **LoRAs:** add_detail, add_more_details, FilmVelvia3 (free)
- **NSFW LoRAs:** smooth_skin, better_hands, erokawa, dramatic_lighting (CivitAI)
- **Embeddings:** EasyNegative, badhandv4

## Decisions made
- **Node.js chosen over Python** for the API server (sd-api.js was built first)
- **No framework** for frontends — plain HTML/JS, opens directly in browser
- **Synthetic data training** — LoRA trainer uses img2img variations as training set, not real photos
- **Flat-file gallery** — PNG files + JSON index, no database, stored on network volume
- **pm2** used to manage Node process on the pod (auto-restart on crash)

## What NOT to do
- Do not add `import` statements mid-file in `api.js` — must all be at the top
- Do not use `require()` in `api.js` — it is an ES module (`"type": "module"`)
- Do not commit `.env` files — only `.env.example`
- Do not hardcode the GitHub username or repo URL in frontend files
- Do not store model files (.safetensors, .ckpt) in the repo — they live on the pod

## Session notes
_Add dated notes here as the project evolves_

- **2024** — Initial build. Full pipeline: SD WebUI + Kohya SS + Node API + 3 frontends + LoRA trainer + gallery + CI
