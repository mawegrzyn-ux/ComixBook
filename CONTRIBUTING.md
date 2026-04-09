# Contributing to ComixBook

## Repo structure

```
frontend/   HTML files — open directly in browser, no build step
server/     Node.js API — runs on the RunPod pod
deploy/     Shell scripts and pod config
docs/       Guides and reference docs
```

## Making changes

### Frontend
Edit any `.html` file directly. Open in browser to test — just point the API URL at a running pod or `localhost:3000`.

### Server (`server/api.js`)
```bash
cd server
cp .env.example .env   # fill in your values
npm install
node api.js            # runs on port 3000
```

Test against a running SD WebUI instance. Set `SD_HOST=http://localhost:7860` in `.env`.

### Deploying changes to the pod

Once you push to `main`, the pod picks up changes on the next restart automatically — `start.sh` runs `git pull` at boot if the repo is cloned at `/workspace/ComixBook`.

To update a running pod without restarting:

```bash
# In JupyterLab terminal or SSH
cd /workspace/ComixBook
git pull
cp server/api.js /workspace/api/api.js
pm2 restart comixbook-api
```

## Branches

| Branch | Purpose |
|---|---|
| `main` | stable — what runs on the pod |
| `dev` | work in progress |

Keep `main` deployable at all times. Test on `dev`, merge to `main` when working.

## CI

GitHub Actions runs on every push and PR:
- Node.js syntax check on `api.js`
- `shellcheck` on `start.sh`
- HTML file integrity check
- Secret scan (no hardcoded tokens)
- `.env.example` completeness check

All checks must pass before merging to `main`.

## Adding a new API endpoint

1. Add the route to `server/api.js`
2. Add to the endpoint table in `README.md`
3. Add a usage example to `server/api-examples.js`
4. If it needs a new env var, add to `server/.env.example`

## Adding a new frontend feature

1. Edit the relevant HTML file in `frontend/`
2. Test locally by opening the file in a browser
3. Update `frontend/README.md` if the feature is significant
