#!/bin/bash

# Creates comma separated string with current withdrawal credentials
all_withdrawal_credentials=""
add_to_withdrawal_credentials() {
    local new_item=$1
    if [[ -n $all_withdrawal_credentials ]]; then
        all_withdrawal_credentials+=",${new_item}"
    else
        all_withdrawal_credentials="${new_item}"
    fi
}

# Check for dependent binaries
check_dependencies() {
    local missing_deps=()

    for cmd in curl deposit jq; do
        if ! command -v "$cmd" &>/dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo "Error: Missing required dependencies: ${missing_deps[*]}"
        exit 1
    fi
}

check_dependencies

# Default values
BEACON_NODE_URL=""
NEW_WITHDRAWAL_CREDENTIALS=""
VALIDATOR_START_INDEX=""
VALIDATOR_STOP_INDEX=""
KURTOSIS_VALIDATOR_MNEMONIC="giant issue aisle success illegal bike spike question tent bar rely arctic volcano long crawl hungry vocal artwork sniff fantasy very lucky have athlete"

# Help text
usage() {
    cat <<EOF
This tool is for changing Ethereum validator withdrawal credentials on a kurtosis local devnet

Usage: $(basename "$0") [OPTIONS]

Options:
    --beacon-node-url              Beacon node URL
    --new-withdrawal-credentials   New withdrawal credentials
    --validator-start-index        Starting index of validator range
    --validator-stop-index         Stopping index of validator range
    -h, --help                     Show this help message
EOF
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --beacon-node-url)
            BEACON_NODE_URL="$2"
            shift 2
            ;;
        --new-withdrawal-credentials)
            NEW_WITHDRAWAL_CREDENTIALS="$2"
            shift 2
            ;;
        --validator-start-index)
            VALIDATOR_START_INDEX="$2"
            shift 2
            ;;
        --validator-stop-index)
            VALIDATOR_STOP_INDEX="$2"
            shift 2
            ;;
        -h | --help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required arguments
if [[ -z "$BEACON_NODE_URL" ]] || [[ -z "$NEW_WITHDRAWAL_CREDENTIALS" ]] ||
    [[ -z "$VALIDATOR_START_INDEX" ]] || [[ -z "$VALIDATOR_STOP_INDEX" ]]; then
    echo "Error: All arguments are required"
    usage
fi

# Create comma separated string with validator indices for deposit-cli
all_validator_indices=$(seq -s, "$VALIDATOR_START_INDEX" "$VALIDATOR_STOP_INDEX")

# Fetch current withdrawal credentials for supplied validator indices and store in string
for i in $(seq "$VALIDATOR_START_INDEX" "$VALIDATOR_STOP_INDEX"); do
    add_to_withdrawal_credentials "$(curl -s "$BEACON_NODE_URL"/eth/v1/beacon/states/head/validators/"$i" | jq -r .data.validator.withdrawal_credentials)"
done

# Fetch genesis validator root and complete devnet chain settings
genesis_validator_root="$(curl -s "$BEACON_NODE_URL"/eth/v1/beacon/genesis | jq -r .data.genesis_validators_root)"
devnet_chain_settings='{"network_name": "kurtosis", "genesis_fork_version": "0x10000038", "genesis_validator_root": "'"$genesis_validator_root"'", "exit_fork_version": "0x03000000"}'

# Create bls-to-execution-change json and extract filename
deposit --language="English" generate-bls-to-execution-change --chain="mainnet" --mnemonic="$KURTOSIS_VALIDATOR_MNEMONIC" --validator_start_index "$VALIDATOR_START_INDEX" --validator_indices "$all_validator_indices" --bls_withdrawal_credentials_list "$all_withdrawal_credentials" --withdrawal_address "$NEW_WITHDRAWAL_CREDENTIALS" --devnet_chain_setting="$devnet_chain_settings"
bls_to_execution_change_filename=$(ls bls_to_execution_changes)

# Send bls_to_execution_change data to beacon node and fetch status code
status_code=$(
    curl -X POST -H 'Content-Type: application/json' \
        -d @bls_to_execution_changes/"$bls_to_execution_change_filename" \
        "$BEACON_NODE_URL"/eth/v1/beacon/pool/bls_to_execution_changes \
        -w '%{http_code}' -s -o /dev/null
)

# Remove bls_to_execution_changes folder
rm -rf bls_to_execution_changes

# Print final output based on status code
if [[ "$status_code" -eq 200 ]]; then
    echo ""
    echo "UPDATED WITHDRAWAL CREDENTIALS SUCCESSFULLY!"
    echo "It might take some time until it is reflected on beacon chain explorers."
else
    echo "Error: Received HTTP status code $status_code"
fi
