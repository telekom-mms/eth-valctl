#!/bin/bash

while IFS='=' read -r key value; do
	if [[ "$key" =~ ^# ]] || [[ -z "$key" ]]; then
		continue
	fi
	export "$key"="$value"
	exported_vars+=("$key")
done <./ethereum-devnet-tags.env

envsubst <./ethereum-devnet.yaml >./ethereum-devnet-replace.yaml
kurtosis run --image-download always --enclave ethereum github.com/ethpandaops/ethereum-package --args-file ./ethereum-devnet-replace.yaml &&
	rm ./ethereum-devnet-replace.yaml &&
	for var in "${exported_vars[@]}"; do
		unset "$var"
	done
