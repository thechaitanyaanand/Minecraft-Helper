#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y git build-essential curl

if apt-cache show python3.11 >/dev/null 2>&1; then
  sudo apt-get install -y python3.11 python3.11-venv python3-pip
  python3.11 -m venv ~/decider-venv
else
  echo "python3.11 not in apt repositories; installing uv to manage Python 3.11..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  uv python install 3.11
  uv venv ~/decider-venv --python 3.11 --seed --clear
fi

source ~/decider-venv/bin/activate
pip install --upgrade pip wheel
pip install "decider-ai[serve]==1.5.0"
python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
# pre-download the model so first start is fast
python -c "from huggingface_hub import snapshot_download; print(snapshot_download('Mapika/decider-2b'))"
