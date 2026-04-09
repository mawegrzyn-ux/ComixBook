# Deploy

Everything needed to get a RunPod pod running.

## Files

### `start.sh`
The pod startup script. Upload this to `/workspace/start.sh` on your network volume before launching a pod.

What it does on each boot:
1. Installs system packages (git, wget, aria2…)
2. Downloads base models (epiCRealism, Realistic Vision V6)
3. Downloads VAE, quality LoRAs, NSFW LoRAs (needs `CIVITAI_TOKEN`)
4. Downloads negative embeddings
5. Installs ADetailer + ControlNet extensions
6. Downloads IP-Adapter face model
7. Installs Kohya SS (LoRA trainer)
8. Creates `/workspace/gallery`
9. Installs JupyterLab → launches on port 8888 via pm2
10. Installs pm2 + API dependencies → launches `api.js` on port 3000 via pm2
11. Launches SD WebUI on port 7860

Downloads skip automatically if files already exist (fast subsequent boots).

### `runpod-template.json`
Reference config for creating a RunPod template. Not used directly — copy the values into the RunPod console UI.

## Setup steps

### 1. Upload files to your network volume

Before launching any pod, upload these two files to the root of your network volume:

```
/workspace/start.sh      ← the startup script
/workspace/api.js        ← the API server (copy from server/api.js)
```

The easiest way: launch any temporary pod with the volume attached, open JupyterLab or the terminal, and paste the file contents.

### 2. Create a RunPod template

Settings to use:

| Field | Value |
|---|---|
| Container image | `runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04` |
| Container disk | 20 GB |
| Volume disk | 100 GB |
| Volume mount path | `/workspace` |
| Expose HTTP ports | `7860, 3000, 8888` |
| Start command | `bash /workspace/start.sh` |

### 3. Set environment variables

| Variable | Where to get it |
|---|---|
| `HF_TOKEN` | huggingface.co → Settings → Access Tokens |
| `CIVITAI_TOKEN` | civitai.com → User → Account → API Keys |
| `API_KEY` | make up a strong password |
| `JUPYTER_PASSWORD` | make up a password |
| `IDLE_MINUTES` | `30` recommended |
| `RUNPOD_API_KEY` | runpod.io → Settings → API Keys |
| `RUNPOD_POD_ID` | shown in RunPod console after pod starts |

### 4. Launch a pod

- GPU: RTX 4090 recommended
- Select your template
- Attach network volume
- First boot: ~25 min
- Subsequent boots: ~3 min
