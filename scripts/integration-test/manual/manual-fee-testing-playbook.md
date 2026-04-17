# Manual Safe Fee Testing Playbook

Manual test scenarios for Safe fee validation — all wait/abort/reject paths at **batch-level** and **per-transaction** levels.

## Prerequisites

- Kurtosis devnet running (beacon `http://localhost:5052`, execution `http://127.0.0.1:8545`)
- Mock TX Service on port 5555
- Safe `0x78a4AA95Ae1031C8ded9c7b11D35AEDfD8dafd7e` deployed (2-of-3 threshold). Deploy extra safe with:

  ```bash
  # extra owner is test ledger address
  bun run scripts/safe/create-safe.ts \
    --extra-owners 0x3D8E1e190e17180757Ff94fDBC26856CC2FBb3DD \
    --hd-owners 2 \
    --threshold 2 \
    --salt-nonce 20 \
    --fund 100 \
    --fund-owners 1
  ```

- Safe validators 1000-1099 (0x01 for Safe), EOA validators 1100-1500 (0x01 for EOA) — see **Initial 0x01 Setup** below

## Shell Helpers

Safe commands prompt for the private key interactively. Do **not** pipe keys via `echo '...' |` — stdin is consumed by the PK prompt, causing follow-up interactive prompts (execute confirmation, stale fee Wait/Reject) to receive EOF and silently skip. Direct commands (`direct_switch`, `direct_exit`) still pipe PK since they have no follow-up prompts.

Paste into your terminal before running scenarios:

```bash
SAFE="0x78a4AA95Ae1031C8ded9c7b11D35AEDfD8dafd7e"
EOA="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
KEY0="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
KEY1="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
RPC="http://127.0.0.1:8545"
BEACON="http://localhost:5052"
CONSOL="0x0000BBdDc7CE488642fb579F8B00f3a590007251"
WITHDR="0x00000961Ef480Eb55e80D19ad83579A64c007002"
TMP="./tmp/manual-test"
mkdir -p "${TMP}"

switch_to_0x01() {
  ./scripts/devnet/switch-withdrawal-credentials-on-kurtosis-devnet.sh \
    --beacon-node-url ${BEACON} \
    --new-withdrawal-credentials "$1" \
    --validator-start-index "$2" --validator-stop-index "$3"
}

fetch_pubkeys() {
  ./scripts/devnet/create-public-key-list-for-consolidation.sh \
    --beacon-node-url ${BEACON} \
    --validator-start-index "$1" --validator-stop-index "$2" --file "${TMP}/$3"
}

safe_propose() {
  local tip="${2:-0}"
  SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} \
    -m 3 --safe ${SAFE} --safe-fee-tip "${tip}" \
    switch -v "${TMP}/$1"
}

safe_propose_exit() {
  local tip="${2:-0}"
  SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} \
    -m 3 --safe ${SAFE} --safe-fee-tip "${tip}" \
    exit -v "${TMP}/$1"
}

safe_sign() {
  SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} --safe ${SAFE} \
    safe sign --yes
}

safe_exec() {
  SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} --safe ${SAFE} \
    safe execute "$@"
}

direct_switch() {
  echo "${KEY0}" | SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} -m 30 \
    switch -v "${TMP}/$1"
}

direct_exit() {
  echo "${KEY0}" | SAFE_API_KEY=test-api-key bun run start \
    -n kurtosis_devnet -r ${RPC} -b ${BEACON} -m 30 \
    exit -v "${TMP}/$1"
}

check_excess() {
  local hex=$(curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getStorageAt\",\"params\":[\"$1\",\"0x0\",\"latest\"],\"id\":1}" \
    "${RPC}" | jq -r .result)
  printf '%d\n' "${hex}"
}

wait_for_decay() {
  local contract="$1" label="$2"
  while true; do
    local dec=$(check_excess "${contract}")
    echo "$(date '+%H:%M:%S') ${label} excess=${dec}"
    [[ ${dec} -le 12 ]] && echo "${label} fee at minimum (1 wei)" && return
    sleep 12
  done
}

check_creds() {
  for i in $(seq "$1" "$2"); do
    curl -s "${BEACON}/eth/v1/beacon/states/head/validators/${i}" | jq -r ".data.validator.withdrawal_credentials[:4]" | xargs -I{} echo "Validator ${i}: {}"
  done
}

check_status() {
  for i in $(seq "$1" "$2"); do
    curl -s "${BEACON}/eth/v1/beacon/states/head/validators/${i}" | jq -r ".data.status" | xargs -I{} echo "Validator ${i}: {}"
  done
}

restart_mock() {
  pkill -f "mock-tx-service/server.ts" 2>/dev/null; sleep 2
  bun run scripts/safe/mock-tx-service/server.ts &
  for i in $(seq 1 30); do
    curl -s http://localhost:5555/api/v1/about/ | grep -q "Safe Transaction Service" && echo "Mock ready" && return
    sleep 1
  done
  echo "Mock failed to start"
}
```

## Initial 0x01 Setup

Run once after deploying a fresh Kurtosis devnet. Switches validators from 0x00 (BLS) to 0x01 pointing to the Safe or EOA address. Takes a few epochs to reflect on-chain.

```bash
switch_to_0x01 ${SAFE} 1000 1099
switch_to_0x01 ${EOA} 1100 1500
```

Verify (sample):

```bash
check_creds 1000 1099
check_creds 1100 1500
```

All should show `0x01`. Wait and re-check if still `0x00`.

---

## Fee Reference

| Excess | Fee (wei) | Notes |
| -------- | --------- | ----- |
| 0-12 | 1 | Minimum plateau |
| 13-19 | 2 | First jump |
| 20-24 | 3 | Exponential growth |

- **Consolidation** (`0x...7251`): excess -1/block. **Withdrawal** (`0x...7002`): excess -2/block.
- Fee frozen at proposal time in MultiSend `value`. **Stale** = proposed < current (would revert).

## Validator Allocation

| # | Scenario | Safe | EOA | Consumed? |
| --- | ---------- | ---- | --- | --------- |
| S1 | Happy path switch | 1000-1005 | — | Yes |
| S2 | Batch stale -> interactive wait | 1006-1011 | 1100-1124 | Yes (retry) |
| S3 | Batch stale -> interactive reject | 1012-1017 | 1125-1149 | No |
| S4 | Batch stale -> `--stale-fee-action wait` | 1018-1023 | 1150-1174 | Yes (retry) |
| S5 | Batch stale -> `--stale-fee-action reject` | 1024-1029 | 1175-1199 | No |
| S6 | Batch stale -> `-y` | 1030-1035 | 1200-1224 | Yes (retry) |
| S7 | Per-tx stale -> interactive wait (success) | 1036-1044 | 1225-1249 | Yes |
| S8 | Per-tx stale -> interactive abort | 1045-1053 | 1250-1274 | Partial |
| S9 | Per-tx stale -> `--max-fee-wait-blocks 1` | 1054-1062 | 1275-1299 | Partial |
| S10 | Per-tx stale -> `--max-fee-wait-blocks 0` | 1063-1071 | 1300-1324 | Partial |
| S11 | Overpaid fee | 1072-1077 | — | Yes |
| S12 | Happy path exit | 1078-1083 | — | Yes |
| S13 | Batch stale exit (withdrawal contract) | 1084-1089 | 1350-1399 | Yes (retry) |
| — | Reserve | 1090-1099 | 1400-1500 | — |

### EOA Queue Fill Ranges

EOA validators are consumed when used for `direct_switch` or `direct_exit`. Each scenario gets a dedicated 25-validator range (pushes excess to ~24, decays in ~2.4 min).

| Range | Purpose |
| ----------- | --------------------------------- |
| 1100-1124 | queue-1 (S2) |
| 1125-1149 | queue-2 (S3) |
| 1150-1174 | queue-3 (S4) |
| 1175-1199 | queue-4 (S5) |
| 1200-1224 | queue-5 (S6) |
| 1225-1249 | queue-6 (S7) |
| 1250-1274 | queue-7 (S8) |
| 1275-1299 | queue-8 (S9) |
| 1300-1324 | queue-9 (S10) |
| 1325-1349 | queue-10 (reserve/refill) |
| 1350-1399 | withdrawal queue fill (S13) |
| 1400-1500 | reserve |

---

## S1: Happy Path Switch (Baseline)

**Precondition:** Consolidation excess <= 12.

```bash
fetch_pubkeys 1000 1005 s1
safe_propose s1 100      # tip=100 wei
safe_sign
safe_exec --yes
```

**Expected:** `All 2 transactions: contract fees sufficient` -> 2 executed.
**Verify:** `check_creds 1000 1005` -> all `0x02`

---

## Queue Fill: Inflate Consolidation Fee

Used to make previously proposed Safe transactions stale. The correct ordering for batch-level stale scenarios (S2-S6) is:

1. **Propose + sign** while excess ≤ 12 (locks in fee = 1 wei with tip=0)
2. **Fill queue** with EOA validators to push excess > 12 (current fee > 1 wei)
3. **Execute** — proposed fee (1 wei) < current fee → stale detection triggers

**Critical ordering:** If you fill the queue BEFORE proposing, the proposed fee captures the elevated fee (> 1 wei). When excess then decays back, execution sees proposed ≥ current → "sufficient", not "stale". Always propose first at low excess, then inflate.

**Important:** Stale scenarios use `safe_propose` with tip=0 (the default). If you proposed with a non-zero tip (e.g. `safe_propose s2 100`), the proposed fee will be 101 wei and will NOT trigger stale detection at moderate excess levels. Re-propose with tip=0.

---

## S2: Batch Stale -> Interactive Wait

**Precondition:** Consolidation excess ≤ 12 (fee at minimum).

```bash
# 1. Propose + sign at low fee
fetch_pubkeys 1006 1011 s2
safe_propose s2           # tip=0 -> proposed fee = 1 wei
safe_sign

# 2. Inflate queue (proposed fee becomes stale)
fetch_pubkeys 1100 1124 queue-1
direct_switch queue-1
check_excess ${CONSOL}   # MUST be > 12 (~24 expected)

# 3. Execute (interactive) — SELECT "Wait"
safe_exec
```

**Expected:**

- Stale warnings for both batches, block estimates
- `Stale fees detected — executing now will revert 2 of 2 transactions`
- Prompt: **Wait** / Reject -> select **Wait** -> exits cleanly

**Retry after decay:**

```bash
wait_for_decay ${CONSOL} "consolidation"
safe_exec --yes
```

**Verify:** `check_creds 1006 1011` -> all `0x02`

---

## S3: Batch Stale -> Interactive Reject

**Precondition:** Consolidation excess ≤ 12 (fee at minimum).

```bash
# 1. Propose + sign at low fee
fetch_pubkeys 1012 1017 s3
safe_propose s3
safe_sign

# 2. Inflate queue (use S3's dedicated range)
fetch_pubkeys 1125 1149 queue-2
direct_switch queue-2
check_excess ${CONSOL}   # MUST be > 12 (~24 expected)

# 3. Execute (interactive) — SELECT "Reject"
safe_exec
```

**Expected:**

- Prompt: Wait / **Reject** -> select **Reject**
- `Rejecting 2 stale transactions...` -> `2 rejection transactions proposed`

**Complete rejection flow:**

```bash
safe_sign                              # sign rejection txs
safe_exec --yes                        # execute rejection txs (no fee needed)
```

**Verify:** `check_creds 1012 1017` -> all still `0x01` (cancelled)

---

## S4-S6: Batch Stale Non-Interactive Variants

Same propose+sign-then-inflate pattern as S2/S3, only the execute command differs.

**Precondition:** Consolidation excess ≤ 12 (fee at minimum) when proposing.

```bash
# S4: --stale-fee-action wait
fetch_pubkeys 1018 1023 s4 && safe_propose s4 && safe_sign
fetch_pubkeys 1150 1174 queue-3 && direct_switch queue-3
check_excess ${CONSOL}   # MUST be > 12
safe_exec --stale-fee-action wait
# Expected: stale warnings, NO prompt, exits immediately (code 0)
# Retry: wait_for_decay ${CONSOL} "consolidation" && safe_exec --yes

# S5: --stale-fee-action reject
fetch_pubkeys 1024 1029 s5 && safe_propose s5 && safe_sign
fetch_pubkeys 1175 1199 queue-4 && direct_switch queue-4
check_excess ${CONSOL}   # MUST be > 12
safe_exec --stale-fee-action reject
# Expected: NO prompt, rejections proposed automatically
# Complete: safe_sign && safe_exec --yes

# S6: -y (auto-wait)
fetch_pubkeys 1030 1035 s6 && safe_propose s6 && safe_sign
fetch_pubkeys 1200 1224 queue-5 && direct_switch queue-5
check_excess ${CONSOL}   # MUST be > 12
safe_exec -y
# Expected: NO prompt, exits immediately (same as --stale-fee-action wait)
# Retry: wait_for_decay ${CONSOL} "consolidation" && safe_exec --yes
```

---

## Per-Transaction Stale: Setup Strategy

Per-tx stale requires batch-level to PASS but per-tx check (after batch 1) to FAIL:

1. Propose with `--safe-fee-tip 0` -> proposed fee = 1 wei
2. Execute when excess = **exactly 12** -> batch-level: fee=1 -> SUFFICIENT
3. Batch 1 MultiSend (3 ops) executes -> excess = 12+3-1 = **14** -> fee = **2 wei** -> STALE for batch 2

**Recovery:** excess 14 -> 12 takes ~2 blocks (24s). Use `--max-fee-wait-blocks` to control behavior.

**Common setup for S7-S10:**

```bash
# 1. Propose + sign (do this while excess <= 12)
fetch_pubkeys <START> <STOP> <name>
safe_propose <name>
safe_sign

# 2. Fill queue with scenario's dedicated range (see EOA Queue Fill Ranges)
fetch_pubkeys <RANGE_START> <RANGE_STOP> queue-N
direct_switch queue-N

# 3. Wait for exact decay to excess = 12
wait_for_decay ${CONSOL} "consolidation"   # waits until excess <= 12
# 4. Execute IMMEDIATELY when excess = 12
```

---

## S7: Per-Tx Stale -> Interactive Wait (Success)

```bash
fetch_pubkeys 1036 1044 s7
safe_propose s7
safe_sign
# Fill queue, then wait for decay to exactly 12
fetch_pubkeys 1225 1249 queue-6 && direct_switch queue-6
wait_for_decay ${CONSOL} "consolidation"
# Execute IMMEDIATELY when excess = 12
safe_exec --max-fee-wait-blocks 5
```

**Expected:**

- `All 3 transactions: contract fees sufficient` (batch-level passes)
- Batch 1 executes
- `Transaction 2/3: proposed fee 1 < current fee 2` -> prompt: **Wait** / Abort
- Select **Wait** -> `Waiting for fee to drop... 1 blocks elapsed`
- `fee is now sufficient, proceeding` -> batches 2+3 execute

**Verify:** `check_creds 1036 1044` -> all `0x02`

---

## S8: Per-Tx Stale -> Interactive Abort

```bash
fetch_pubkeys 1045 1053 s8
safe_propose s8
safe_sign
# Fill queue, then wait for decay to exactly 12
fetch_pubkeys 1250 1274 queue-7 && direct_switch queue-7
wait_for_decay ${CONSOL} "consolidation"
# Execute IMMEDIATELY when excess = 12
safe_exec
```

**Expected:**

- Batch 1 executes
- Per-tx stale on batch 2 -> prompt: Wait / **Abort** -> select **Abort**
- `Remaining Safe transaction hashes not executed:` (2 hashes printed)
- Exit code **1**

**Cleanup:** `safe_exec` after excess is low enough
**Verify:** `check_creds 1045 1047` -> `0x02` (batch 1), `check_creds 1048 1053` -> `0x01` (aborted)

---

## S9-S10: Per-Tx Stale Max-Wait Variants

Same propose+sign, only execute flags differ. Both abort immediately because estimated blocks (2) exceeds max wait.

```bash
# S9: --max-fee-wait-blocks 1 (estimated 2 > max 1 -> abort)
fetch_pubkeys 1054 1062 s9 && safe_propose s9 && safe_sign
fetch_pubkeys 1275 1299 queue-8 && direct_switch queue-8
wait_for_decay ${CONSOL} "consolidation"
# Execute IMMEDIATELY when excess = 12
safe_exec --stale-fee-action wait --max-fee-wait-blocks 1
# Expected: "Estimated 2 blocks exceeds max wait of 1 blocks — aborting"
# Exit code 1. Cleanup: `safe_exec` after excess is low enough

# S10: --max-fee-wait-blocks 0 (any stale -> immediate abort)
fetch_pubkeys 1063 1071 s10 && safe_propose s10 && safe_sign
fetch_pubkeys 1300 1324 queue-9 && direct_switch queue-9
wait_for_decay ${CONSOL} "consolidation"
# Execute IMMEDIATELY when excess = 12
safe_exec --stale-fee-action wait --max-fee-wait-blocks 0
# Expected: "Estimated 2 blocks exceeds max wait of 0 blocks — aborting"
# Exit code 1. Cleanup: `safe_exec` after excess is low enough
```

---

## S11: Overpaid Fee (Warning Only)

**Precondition:** Consolidation excess <= 12.

```bash
fetch_pubkeys 1072 1077 s11
safe_propose s11 10000    # tip=10000 wei -> proposed = 10001 wei
safe_sign
safe_exec --yes
```

**Expected:**

- `Batch 1/2: proposed fee 10001 > current fee 1 (overpayment: 10000 wei)` (blue info, NOT blocking)
- Both batches execute successfully

**Verify:** `check_creds 1072 1077` -> all `0x02`

---

## S12: Happy Path Exit (Withdrawal Contract)

**Precondition:** Both contract excesses <= 12.

### Step A: Switch to 0x02

```bash
fetch_pubkeys 1078 1083 s12
safe_propose s12 100
safe_sign
safe_exec --yes

# Wait for credential change
for i in $(seq 1078 1083); do
  while true; do
    CRED=$(curl -s "${BEACON}/eth/v1/beacon/states/head/validators/${i}" | jq -r '.data.validator.withdrawal_credentials[:4]')
    [[ "${CRED}" == "0x02" ]] && break; sleep 12
  done
done
```

### Step B: Exit

```bash
safe_propose_exit s12 100
safe_sign
safe_exec --yes
```

**Verify:** `check_status 1078 1083` -> all `active_exiting`

---

## S13: Batch Stale Exit (Withdrawal Contract)

Tests stale fee on the **withdrawal contract** (decay rate 2/block vs 1/block).

### Step A: Switch Safe + EOA validators to 0x02

```bash
# Safe validators
fetch_pubkeys 1084 1089 s13-safe
safe_propose s13-safe 100 && safe_sign && safe_exec --yes

# EOA validators (for queue filling)
fetch_pubkeys 1350 1399 s13-eoa
direct_switch s13-eoa

# Wait for 0x02 (sample check)
while true; do
  CRED=$(curl -s "${BEACON}/eth/v1/beacon/states/head/validators/1084" | jq -r '.data.validator.withdrawal_credentials[:4]')
  [[ "${CRED}" == "0x02" ]] && break; sleep 12
done
```

### Step B: Propose exit, fill queue, execute

```bash
# Propose exit at fee = 1 wei (ensure withdrawal excess <= 12 first)
safe_propose_exit s13-safe
safe_sign

# Fill withdrawal queue
direct_exit s13-eoa

# Execute (batch-level stale on withdrawal contract)
safe_exec --stale-fee-action wait
# Expected: stale warnings with withdrawal contract, exits immediately

# Retry after decay (2x faster than consolidation)
wait_for_decay ${WITHDR} "withdrawal"
safe_exec --yes
```

**Verify:** `check_status 1084 1089` -> all `active_exiting`
