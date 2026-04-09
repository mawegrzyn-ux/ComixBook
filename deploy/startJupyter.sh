#!/bin/bash
# ============================================================
#  startJupyter.sh — first boot bootstrap
#  Paste contents into RunPod "Container start command" field.
#  Launches JupyterLab so you can upload start.sh and api.js
#  via the browser file manager.
#
#  Once uploaded, stop the pod and change start command to:
#    bash /workspace/start.sh
# ============================================================

echo "Installing JupyterLab..."
pip install -q jupyterlab

echo ""
echo "================================================"
echo " JupyterLab starting on port 8888"
echo " No password — open straight away"
echo " URL: https://<POD_ID>-8888.proxy.runpod.net"
echo ""
echo " Upload to /workspace/:"
echo "   deploy/start.sh  →  /workspace/start.sh"
echo "   server/api.js    →  /workspace/api.js"
echo ""
echo " Then stop pod, change start command to:"
echo "   bash /workspace/start.sh"
echo "================================================"
echo ""

jupyter lab \
  --ip=0.0.0.0 \
  --port=8888 \
  --no-browser \
  --allow-root \
  --NotebookApp.token='' \
  --NotebookApp.password='' \
  --notebook-dir=/workspace
