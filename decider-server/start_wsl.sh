#!/usr/bin/env bash
set -euo pipefail
source ~/decider-venv/bin/activate
export DECIDER_MODEL="${DECIDER_MODEL:-Mapika/decider-2b}"
export DECIDER_DEVICE="${DECIDER_DEVICE:-cuda}"
export DECIDER_MAX_BATCH="${DECIDER_MAX_BATCH:-8}"
export DECIDER_WARMUP="${DECIDER_WARMUP:-0}"
export DECIDER_FP8="${DECIDER_FP8:-1}"
export DECIDER_SHARED_FORK_GB="${DECIDER_SHARED_FORK_GB:-4}"
# 0.0.0.0 inside WSL is only reachable from this Windows PC (WSL NAT), not from the LAN.
exec uvicorn decider.serve:app --host 0.0.0.0 --port 8000
