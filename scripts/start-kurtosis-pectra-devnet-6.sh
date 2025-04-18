#!/bin/bash

while IFS='=' read -r key value; do
    if [[ "$key" =~ ^# ]] || [[ -z "$key" ]]; then
        continue
    fi
    export "$key"="$value"
    exported_vars+=("$key")
done <./ethereum-pectra-devnet-6-tags.env

envsubst <./ethereum-pectra-devnet-6.yaml >./ethereum-pectra-devnet-6-replace.yaml
kurtosis run --image-download always --enclave local-pectra-devnet-6 github.com/ethpandaops/ethereum-package --args-file ./ethereum-pectra-devnet-6-replace.yaml &&
    rm ./ethereum-pectra-devnet-6-replace.yaml &&
    for var in "${exported_vars[@]}"; do
        unset "$var"
    done
