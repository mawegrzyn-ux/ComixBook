# ComixBook

AI-powered comic creation studio. Generate panels, train character LoRAs, compose pages — all in the browser, running on a RunPod GPU pod.

---

## What's in this repo

```
ComixBook/
├── frontend/
│   ├── comic-studio.html   Full studio — script editor, panel generator,
│   │                       composer, LoRA trainer, gallery
│   ├── studio.html         Advanced SD interface — txt2img, img2img,
│   │                       ControlNet, IP-Adapter, LoRA manager, presets
│   └── beginner.html       Simplified noob-friendly image generator
│
├── server/
│   ├── api.js              Node.js/Express API wrapper (canonical)
│   ├── api.py              Python/FastAPI alternative
│   ├── api-examples.js     Client usage examples
│   ├── package.json        Node dependencies
│   └── .env.example        Environment variable template
│
├── deploy/
│   ├── start.sh            RunPod pod startup script
│   └── runpod-template.json RunPod template config reference
│
└── docs/
    └── deployment-guide.docx Full setup guide
```

---

## Quick start

### 1. Set up RunPod

- Create a **network volume** (100 GB) at `runpod.io → Storage`
- Create a **template** using `deploy/runpod-template.json` as reference
- Set environment variables (see `server/.env.example`)
- Upload `deploy/start.sh` and `server/api.js` to `/workspace/` on your volume

### 2. Launch a pod

- GPU: RTX 4090 recommended (24 GB VRAM)
- Attach your network volume
- First boot takes ~25 min (downloads models, installs everything)

### 3. Open a frontend

Open any `.html` file from `frontend/` directly in your browser — no build step needed.

Connect to your pod:
| Field | Value |
|---|---|
| Server URL | `https://<POD_ID>-3000.proxy.runpod.net` |
| API Key | value of `API_KEY` env var |

---

## Services on the pod

| Service | Port | URL |
|---|---|---|
| SD WebUI (AUTOMATIC1111) | 7860 | `https://<POD_ID>-7860.proxy.runpod.net` |
| API Wrapper (Node.js) | 3000 | `https://<POD_ID>-3000.proxy.runpod.net` |
| JupyterLab | 8888 | `https://<POD_ID>-8888.proxy.runpod.net` |

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Status, queue depth, idle timer |
| GET | `/models` | List checkpoints |
| POST | `/models/switch` | Switch active model |
| POST | `/generate/txt2img` | Text → image (queued) |
| POST | `/generate/img2img` | Image → image (queued) |
| POST | `/inpaint` | Inpaint masked region |
| GET | `/progress` | Generation progress % |
| POST | `/interrupt` | Cancel current generation |
| POST | `/caption` | CLIP caption an image |
| POST | `/upscale` | Upscale with R-ESRGAN |
| GET | `/queue` | Queue state |
| GET | `/queue/:id` | Job status + result |
| POST | `/queue/:id/cancel` | Cancel queued job |
| GET | `/idle` | Idle timer status |
| POST | `/gallery/save` | Save images |
| GET | `/gallery` | Browse with filter/search |
| GET | `/gallery/:id/image` | Serve image file |
| PATCH | `/gallery/:id` | Update tags/prompt |
| DELETE | `/gallery/:id` | Delete image |
| POST | `/train/lora` | Start LoRA training |
| GET | `/train/status/:id` | Training progress |
| POST | `/train/cancel/:id` | Cancel training |
| GET | `/train/download/:id` | Download .safetensors |
| POST | `/train/test/:id` | Generate 4 test images |

All endpoints require `x-api-key` header except `/health` and image serving endpoints (which accept `?key=` query param).

---

## Running costs (RunPod)

| GPU | $/hr | Use for |
|---|---|---|
| RTX 3090 | ~$0.44 | light generation |
| RTX 4090 | ~$0.74 | recommended |
| A100 SXM | ~$1.89 | heavy training |

Use **Spot** instances for generation (~50% cheaper). Use **On-Demand** for LoRA training (uninterrupted).

Set `IDLE_MINUTES=30` + `RUNPOD_API_KEY` + `RUNPOD_POD_ID` for automatic shutdown when idle.

---

## See also

`docs/deployment-guide.docx` — full step-by-step setup guide including troubleshooting.
