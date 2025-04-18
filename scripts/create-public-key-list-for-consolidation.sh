#!/bin/bash

# Creates comma separated string with current withdrawal credentials
all_validator_pubkeys=""
add_to_validator_list() {
    local new_item=$1
    if [[ -n $all_validator_pubkeys ]]; then
        all_validator_pubkeys+=" ${new_item}"
    else
        all_validator_pubkeys="${new_item}"
    fi
}

# Check for dependent binaries
check_dependencies() {
    local missing_deps=()

    for cmd in curl jq; do
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

BEACON_NODE_URL=""
VALIDATOR_START_INDEX=""
VALIDATOR_STOP_INDEX=""

# Help text
usage() {
    cat <<EOF
This tool is for extracting validator public keys on a kurtosis local devnet

Usage: $(basename "$0") [OPTIONS]

Options:
    --beacon-node-url              Beacon node URL
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
if [[ -z "$BEACON_NODE_URL" ]] || [[ -z "$VALIDATOR_START_INDEX" ]] || [[ -z "$VALIDATOR_STOP_INDEX" ]]; then
    echo "Error: All arguments are required"
    usage
fi

for i in $(seq "$VALIDATOR_START_INDEX" "$VALIDATOR_STOP_INDEX"); do
    add_to_validator_list "$(curl -s "$BEACON_NODE_URL"/eth/v1/beacon/states/head/validators/"$i" | jq -r .data.validator.pubkey)"
done

echo "$all_validator_pubkeys"
