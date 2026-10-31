# Manual Deposit Ledger Playbook

Manual test scenarios for `deposit` with a Ledger device on hoodi. The automated deposit scenarios run in
integration test phase J against a kurtosis devnet with a private key.

## Prerequisites

- Ledger with the Ethereum app open; the selected address (`44'/60'/0'/0/x`) holds about 100 hoodi ETH. Fund it from a
  hoodi faucet before starting: scenarios 2 and 3 spend 65 ETH, and scenario 5 still needs 32 ETH plus gas to pass the
  balance check before the summary prompt
- hoodi execution and beacon endpoints
- `ethstaker-deposit-cli` (`deposit`) on PATH

## Shell Helpers

```bash
RPC="<hoodi json-rpc url>"
BEACON="<hoodi beacon api url>"
LEDGER_ADDRESS="<address selected on the Ledger>"
TMP="./tmp/manual-deposit"
mkdir -p "${TMP}"

deposit --language English generate-mnemonic --mnemonic_language english --output_file "${TMP}/mnemonic.txt"

generate() {
  local folder=$1
  shift
  rm -rf "${folder}"
  mkdir -p "${folder}"
  deposit --language English --non_interactive existing-mnemonic \
    --mnemonic "$(cat "${TMP}/mnemonic.txt")" --mnemonic_language english \
    --validator_start_index "$1" --num_validators 1 --folder "${folder}" --chain hoodi \
    --keystore_password manual-test --pbkdf2 --withdrawal_address "${LEDGER_ADDRESS}" "${@:2}" </dev/null >"${folder}/deposit-cli.log" 2>&1
  ls "${folder}"/validator_keys/deposit_data-*.json
}

ledger_deposit() {
  bun run start -n hoodi -r "${RPC}" -b "${BEACON}" --ledger deposit -d "$1"
}
```

## Scenarios

### 1. Debug contracts disabled → clear error

1. In the Ethereum app settings, enable "Blind signing" and disable "Debug contracts".
1. `REGULAR_FILE=$(generate "${TMP}/regular" 0 --regular-withdrawal)`
1. `ledger_deposit "${REGULAR_FILE}"`, select the address, confirm the summary.

**Expected:** the device rejects the transaction (the built-in deposit plugin only accepts device-derived
credentials). eth-valctl prints the "Enable both "Blind signing" and "Debug contracts"" message, reports the
transaction as failed, sends nothing and exits with code 0.

### 2. 0x01 deposit (32 ETH)

1. Enable "Blind signing" and "Debug contracts".
1. `ledger_deposit "${REGULAR_FILE}"`

**Expected:** the summary shows `0x01 → <ledger address, lower-case> (1)`; the device shows the deposit contract, 32 ETH and the
raw calldata screens; the progress output labels the transaction with the pubkey of the file. After mining, the
pubkey is listed in `${BEACON}/eth/v1/beacon/states/head/pending_deposits` with amount `32000000000`.

### 3. 0x02 deposit (33 ETH)

1. `ledger_deposit "$(generate "${TMP}/compounding" 1 --compounding --amount 33)"`

**Expected:** the summary shows `0x02 → <ledger address, lower-case> (1)` and 33 ETH; after mining, the pending deposit has
amount `33000000000` and 0x02 credentials.

### 4. Re-run is skipped

1. `ledger_deposit "${REGULAR_FILE}"` after the scenario 2 transaction is mined.

**Expected:** "already has a pending deposit with the same withdrawal address — skipping", "No transaction was
sent", exit code 0, no device prompt for signing.

### 5. Decline at the summary

1. Generate a third key (`generate "${TMP}/declined" 2 --regular-withdrawal`), run `ledger_deposit` and answer `N`.

**Expected:** "Deposit cancelled. No transaction was sent.", exit code 0, the device is released.
