#!/bin/bash
set -euo pipefail

PIDS=()

cleanup() {
	for pid in "${PIDS[@]}"; do
		kill "$pid" 2>/dev/null || true
	done
	exit 0
}

trap cleanup SIGINT SIGTERM EXIT

if ! command -v socat &>/dev/null; then
	echo "Error: socat is not installed" >&2
	exit 1
fi

for port in 8545 5052; do
	if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
		echo "Error: port ${port} is already in use" >&2
		exit 1
	fi
done

socat TCP-LISTEN:8545,fork,bind=0.0.0.0 TCP:127.0.0.1:32003 &
PIDS+=($!)
socat TCP-LISTEN:5052,fork,bind=0.0.0.0 TCP:127.0.0.1:33022 &
PIDS+=($!)

echo "Forwarding 0.0.0.0:8545 -> 127.0.0.1:32003 (EL)"
echo "Forwarding 0.0.0.0:5052 -> 127.0.0.1:33022 (CL)"
echo "Press Ctrl+C to stop"

wait
