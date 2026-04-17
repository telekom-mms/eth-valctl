#!/bin/bash
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# --- Constants ---

DEPLOYER_PRIVATE_KEY="0xbcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31"
CHAIN_ID="3151908"
MNEMONIC="giant issue aisle success illegal bike spike question tent bar rely arctic volcano long crawl hungry vocal artwork sniff fantasy very lucky have athlete"
SINGLETON_FACTORY_BYTECODE="0x604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
FACTORY_SIGNER_ADDRESS="0xE1CB04A0fA36DdD16a06ea828007E35e1a3cBC37"
DEFAULT_SAFE_VERSION="release/v1.4.1"
SAFE_SINGLETON_FACTORY_NPM_VERSION="1.0.44"
CLONE_DIR="${PROJECT_DIR}/tmp/safe-smart-account"
MAX_HH501_RETRIES=10

DEPLOYMENT_FILES=(
	"Safe"
	"SafeL2"
	"SafeProxyFactory"
	"MultiSend"
	"MultiSendCallOnly"
	"CompatibilityFallbackHandler"
	"SignMessageLib"
	"CreateCall"
	"SimulateTxAccessor"
)

# --- Platform detection ---

detect_platform() {
	case "$(uname -s)" in
	Linux)
		SOLC_PLATFORM="linux-amd64"
		HARDHAT_CACHE_DIR="${HOME}/.cache/hardhat-nodejs"
		sed_inplace() { sed -i "$@"; }
		;;
	Darwin)
		SOLC_PLATFORM="macosx-amd64"
		HARDHAT_CACHE_DIR="${HOME}/Library/Caches/hardhat-nodejs"
		sed_inplace() { sed -i '' "$@"; }
		;;
	*)
		echo "ERROR: Unsupported platform: $(uname -s)" >&2
		exit 1
		;;
	esac
}

# --- Help ---

usage() {
	cat <<'EOF'
Usage: deploy-safe-infra.sh --json-rpc-url <url> [OPTIONS]

Deploy Safe multisig infrastructure on a Kurtosis devnet.

Required:
  --json-rpc-url <url>      Execution layer JSON-RPC endpoint

Options:
  --safe-repo <path>        Path to existing safe-smart-account checkout (skips clone)
  --safe-version <branch>   Git branch/tag to clone (default: release/v1.4.1)
                            Ignored when --safe-repo is set
  --skip-safe-creation      Skip Safe wallet creation (create-safe.ts)
  -h, --help                Show this help message

The script performs these steps:
  1. Clone safe-smart-account repo (or use --safe-repo)
  2. Install npm dependencies
  3. Deploy CREATE2 singleton factory
  4. Compile Solidity (auto-downloads solc on HH501 error)
  5. Deploy Safe singleton contracts
  6. Update scripts/safe/constants.ts with deployed addresses
  7. Update src/network-config.ts with deployed addresses
  8. Create Safe wallet instance (2-of-3 multisig)
  9. Updates scripts/integration-test/constants.sh with Safe address

Examples:
  deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003
  deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003 --safe-version release/v1.5.0
  deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003 --safe-repo ~/safe-smart-account
EOF
	exit 0
}

# --- Dependency checks ---

check_dependencies() {
	local missing_deps=()
	for cmd in git cast jq curl npm npx bun sed; do
		if ! command -v "${cmd}" &>/dev/null; then
			missing_deps+=("${cmd}")
		fi
	done
	if [[ ${#missing_deps[@]} -ne 0 ]]; then
		echo "ERROR: Missing required dependencies: ${missing_deps[*]}" >&2
		exit 1
	fi
}

# --- Step 0: Clone repo ---

step_clone_repo() {
	local safe_version="$1"

	if [[ -d "${CLONE_DIR}" ]]; then
		local current_branch
		current_branch=$(git -C "${CLONE_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
		if [[ "${current_branch}" == "${safe_version}" ]]; then
			echo "  safe-smart-account already cloned at ${CLONE_DIR} (branch: ${current_branch})"
			return 0
		fi
		echo "ERROR: ${CLONE_DIR} exists but is on branch '${current_branch}', expected '${safe_version}'" >&2
		echo "  Delete the directory or use --safe-repo to point to your checkout" >&2
		exit 1
	fi

	echo "  Cloning safe-smart-account (branch: ${safe_version})..."
	git clone --branch "${safe_version}" --depth 1 \
		https://github.com/safe-global/safe-smart-account.git "${CLONE_DIR}"
}

# --- Step 1: npm install ---

step_npm_install() {
	cd "${SAFE_REPO}"

	if [[ -d "node_modules" ]]; then
		echo "  node_modules/ already exists, skipping npm install"
		return 0
	fi

	echo "  Running npm install --ignore-scripts..."
	npm install --ignore-scripts

	echo "  Installing @safe-global/safe-singleton-factory@${SAFE_SINGLETON_FACTORY_NPM_VERSION}..."
	npm i --save-dev "@safe-global/safe-singleton-factory@${SAFE_SINGLETON_FACTORY_NPM_VERSION}"
}

# --- Step 2: Create .env ---

step_create_env() {
	cd "${SAFE_REPO}"

	cat >"${SAFE_REPO}/.env" <<EOF
MNEMONIC="${MNEMONIC}"
NODE_URL=${JSON_RPC_URL}
EOF
	echo "  Created .env with NODE_URL=${JSON_RPC_URL}"
}

# --- Step 3: Deploy singleton factory ---

step_deploy_singleton_factory() {
	cd "${SAFE_REPO}"

	local deployment_json="${SAFE_REPO}/node_modules/@safe-global/safe-singleton-factory/artifacts/${CHAIN_ID}/deployment.json"

	if [[ -f "${deployment_json}" ]]; then
		local existing_addr
		existing_addr=$(jq -r '.address' "${deployment_json}")
		local code_at_addr
		code_at_addr=$(cast code "${existing_addr}" --rpc-url "${JSON_RPC_URL}" 2>/dev/null || echo "0x")
		if [[ "${code_at_addr}" != "0x" && -n "${code_at_addr}" ]]; then
			echo "  Singleton factory already deployed at ${existing_addr}"
			return 0
		fi
	fi

	echo "  Deploying singleton factory..."
	local deploy_output
	deploy_output=$(cast send \
		--private-key "${DEPLOYER_PRIVATE_KEY}" \
		--rpc-url "${JSON_RPC_URL}" \
		--create "${SINGLETON_FACTORY_BYTECODE}" \
		--json)

	local factory_address
	factory_address=$(echo "${deploy_output}" | jq -r '.contractAddress')

	echo "  Singleton factory deployed at: ${factory_address}"

	mkdir -p "$(dirname "${deployment_json}")"
	cat >"${deployment_json}" <<EOF
{
  "gasPrice": 100000000000,
  "gasLimit": 100000,
  "signerAddress": "${FACTORY_SIGNER_ADDRESS}",
  "transaction": "0x00",
  "address": "${factory_address}"
}
EOF
	echo "  Registered in deployment.json"
}

# --- Step 4: Compile with HH501 auto-retry ---

download_and_cache_solc() {
	local solc_version="$1"
	local version_commit="$2"

	local cache_dir="${HARDHAT_CACHE_DIR}/compilers-v2/${SOLC_PLATFORM}"
	local cache_file="${cache_dir}/solc-${SOLC_PLATFORM}-v${version_commit}"

	if [[ -f "${cache_file}" && -x "${cache_file}" ]]; then
		echo "  solc ${version_commit} already in Hardhat cache"
		return 0
	fi

	mkdir -p "${cache_dir}"

	local tmp_file
	tmp_file=$(mktemp)

	local primary_url="https://binaries.soliditylang.org/${SOLC_PLATFORM}/solc-${SOLC_PLATFORM}-v${version_commit}"
	echo "  Downloading solc from ${primary_url}..."

	if curl -4 -k -L -f -o "${tmp_file}" "${primary_url}" 2>/dev/null; then
		echo "  Downloaded from primary source"
	else
		local fallback_url
		if [[ "${SOLC_PLATFORM}" == "macosx-amd64" ]]; then
			fallback_url="https://github.com/ethereum/solidity/releases/download/v${solc_version}/solc-macos"
		else
			fallback_url="https://github.com/ethereum/solidity/releases/download/v${solc_version}/solc-static-linux"
		fi
		echo "  Primary failed. Trying GitHub: ${fallback_url}..."

		if ! curl -4 -k -L -f -o "${tmp_file}" "${fallback_url}" 2>/dev/null; then
			echo "ERROR: Could not download solc ${version_commit} from any source" >&2
			rm -f "${tmp_file}"
			exit 1
		fi
		echo "  Downloaded from GitHub releases"
	fi

	mv "${tmp_file}" "${cache_file}"
	chmod +x "${cache_file}"
	echo "  Cached at ${cache_file}"
}

step_compile_with_hh501_retry() {
	cd "${SAFE_REPO}"

	local attempt=0

	local compile_log
	compile_log=$(mktemp)
	# shellcheck disable=SC2064
	trap "rm -f '${compile_log}'" RETURN

	while ((attempt < MAX_HH501_RETRIES)); do
		attempt=$((attempt + 1))
		echo "  Compile attempt ${attempt}/${MAX_HH501_RETRIES}..."

		local compile_exit_code=0
		npx hardhat compile 2>&1 | tee "${compile_log}" || compile_exit_code=$?

		if [[ ${compile_exit_code} -eq 0 ]]; then
			echo "  Compilation succeeded"
			return 0
		fi

		if ! grep -q "HH501" "${compile_log}"; then
			echo "ERROR: Hardhat compilation failed with non-HH501 error" >&2
			exit 1
		fi

		local version_commit
		version_commit=$(grep -oE 'compiler version [0-9]+\.[0-9]+\.[0-9]+\+commit\.[a-f0-9]+' "${compile_log}" | sed 's/compiler version //' | head -1)

		if [[ -z "${version_commit}" ]]; then
			echo "ERROR: Could not extract solc version from HH501 error" >&2
			exit 1
		fi

		local solc_version
		solc_version=$(echo "${version_commit}" | cut -d'+' -f1)

		echo "  HH501: Need solc ${version_commit}"
		download_and_cache_solc "${solc_version}" "${version_commit}"
	done

	echo "ERROR: Compilation failed after ${MAX_HH501_RETRIES} HH501 retries" >&2
	exit 1
}

# --- Step 5: Deploy Safe contracts ---

step_deploy_contracts() {
	cd "${SAFE_REPO}"

	if [[ -f "deployments/custom/Safe.json" ]]; then
		local existing_addr
		existing_addr=$(jq -r '.address' "deployments/custom/Safe.json")
		local code
		code=$(cast code "${existing_addr}" --rpc-url "${JSON_RPC_URL}" 2>/dev/null || echo "0x")
		if [[ "${code}" != "0x" && -n "${code}" ]]; then
			echo "  Safe contracts already deployed (Safe at ${existing_addr})"
			return 0
		fi
	fi

	echo "  Running npm run deploy-all custom..."
	npm run deploy-all custom || true

	local missing=()
	for name in "${DEPLOYMENT_FILES[@]}"; do
		if [[ ! -f "deployments/custom/${name}.json" ]]; then
			missing+=("${name}")
		fi
	done

	if [[ ${#missing[@]} -ne 0 ]]; then
		echo "ERROR: Deployment incomplete — missing: ${missing[*]}" >&2
		exit 1
	fi

	echo "  All ${#DEPLOYMENT_FILES[@]} contracts deployed"
}

# --- Step 6: Update constants.ts ---

step_update_constants() {
	local deployments_dir="${SAFE_REPO}/deployments/custom"
	local constants_file="${PROJECT_DIR}/scripts/safe/constants.ts"

	declare -A address_map=(
		["Safe.json"]="safeSingletonAddress"
		["SafeL2.json"]="safeSingletonL2Address"
		["SafeProxyFactory.json"]="safeProxyFactoryAddress"
		["MultiSend.json"]="multiSendAddress"
		["MultiSendCallOnly.json"]="multiSendCallOnlyAddress"
		["CompatibilityFallbackHandler.json"]="fallbackHandlerAddress"
		["SignMessageLib.json"]="signMessageLibAddress"
		["CreateCall.json"]="createCallAddress"
		["SimulateTxAccessor.json"]="simulateTxAccessorAddress"
	)

	for deploy_file in "${!address_map[@]}"; do
		local field="${address_map[${deploy_file}]}"
		local addr
		addr=$(jq -r '.address' "${deployments_dir}/${deploy_file}")

		if [[ -z "${addr}" || "${addr}" == "null" ]]; then
			echo "ERROR: Could not read address from ${deploy_file}" >&2
			exit 1
		fi

		sed_inplace "s|${field}: '[^']*'|${field}: '${addr}'|" "${constants_file}"
		echo "  ${field}: ${addr}"
	done

	local escaped_url
	escaped_url=$(printf '%s\n' "${JSON_RPC_URL}" | sed 's|[&/\]|\\&|g')
	sed_inplace "s|'http://127\.0\.0\.1:[0-9]*'|'${escaped_url}'|" "${constants_file}"
	echo "  RPC_URL default: ${JSON_RPC_URL}"
}

# --- Step 7: Update network-config.ts ---

step_update_network_config() {
	local deployments_dir="${SAFE_REPO}/deployments/custom"
	local config_file="${PROJECT_DIR}/src/network-config.ts"

	declare -A nc_map=(
		["SafeL2.json"]="safeSingletonAddress"
		["SafeProxyFactory.json"]="safeProxyFactoryAddress"
		["MultiSend.json"]="multiSendAddress"
		["MultiSendCallOnly.json"]="multiSendCallOnlyAddress"
		["CompatibilityFallbackHandler.json"]="fallbackHandlerAddress"
		["SignMessageLib.json"]="signMessageLibAddress"
		["CreateCall.json"]="createCallAddress"
		["SimulateTxAccessor.json"]="simulateTxAccessorAddress"
	)

	for deploy_file in "${!nc_map[@]}"; do
		local field="${nc_map[${deploy_file}]}"
		local addr
		addr=$(jq -r '.address' "${deployments_dir}/${deploy_file}")

		sed_inplace "s|${field}: '[^']*'|${field}: '${addr}'|" "${config_file}"
		echo "  ${field}: ${addr}"
	done
}

# --- Step 8: Create Safe wallet ---

step_create_safe() {
	cd "${PROJECT_DIR}"

	echo "  Running create-safe.ts..."
	local create_output
	create_output=$(KURTOSIS_RPC_URL="${JSON_RPC_URL}" bun run scripts/safe/create-safe.ts 2>&1)
	echo "${create_output}"

	local safe_address
	safe_address=$(echo "${create_output}" | grep -oE 'Safe (deployed successfully at|already deployed at) 0x[a-fA-F0-9]{40}' | grep -oE '0x[a-fA-F0-9]{40}' | head -1)

	if [[ -z "${safe_address}" ]]; then
		safe_address=$(echo "${create_output}" | grep -oE 'Predicted Safe address: 0x[a-fA-F0-9]{40}' | grep -oE '0x[a-fA-F0-9]{40}' | head -1)
	fi

	if [[ -z "${safe_address}" ]]; then
		echo "WARNING: Could not extract Safe address from create-safe.ts output" >&2
		return 0
	fi

	echo "  Updating integration test constants with Safe address: ${safe_address}"
	local constants_sh="${PROJECT_DIR}/scripts/integration-test/constants.sh"
	local change_threshold_ts="${PROJECT_DIR}/scripts/integration-test/change-threshold.ts"
	local propose_foreign_ts="${PROJECT_DIR}/scripts/integration-test/propose-foreign-tx.ts"

	sed_inplace "s|SAFE_ADDRESS=\"\${SAFE_ADDRESS:-[^}]*}\"|SAFE_ADDRESS=\"\${SAFE_ADDRESS:-${safe_address}}\"|" "${constants_sh}"
	sed_inplace "s|process\.env\.SAFE_ADDRESS ?? '[^']*'|process.env.SAFE_ADDRESS ?? '${safe_address}'|" "${change_threshold_ts}"
	sed_inplace "s|process\.env\.SAFE_ADDRESS ?? '[^']*'|process.env.SAFE_ADDRESS ?? '${safe_address}'|" "${propose_foreign_ts}"
}

# --- Main ---

main() {
	local safe_repo=""
	local safe_version="${DEFAULT_SAFE_VERSION}"
	local json_rpc_url=""
	local skip_safe_creation=false

	while [[ $# -gt 0 ]]; do
		case "$1" in
		--safe-repo)
			safe_repo="$2"
			shift 2
			;;
		--safe-version)
			safe_version="$2"
			shift 2
			;;
		--json-rpc-url)
			json_rpc_url="$2"
			shift 2
			;;
		--skip-safe-creation)
			skip_safe_creation=true
			shift
			;;
		-h | --help)
			usage
			;;
		*)
			echo "ERROR: Unknown option '$1'" >&2
			usage
			;;
		esac
	done

	if [[ -z "${json_rpc_url}" ]]; then
		echo "ERROR: --json-rpc-url is required" >&2
		echo "" >&2
		usage
	fi

	JSON_RPC_URL="${json_rpc_url}"

	detect_platform
	check_dependencies

	echo "=== Safe Infrastructure Deployment ==="
	echo "  JSON-RPC URL: ${JSON_RPC_URL}"

	if [[ -n "${safe_repo}" ]]; then
		SAFE_REPO="$(cd "${safe_repo}" && pwd)"
		if [[ ! -f "${SAFE_REPO}/package.json" ]]; then
			echo "ERROR: ${SAFE_REPO} does not contain package.json" >&2
			exit 1
		fi
		echo "  Safe repo:    ${SAFE_REPO} (provided)"
	else
		SAFE_REPO="${CLONE_DIR}"
		echo "  Safe repo:    ${SAFE_REPO} (auto-clone, branch: ${safe_version})"
		echo ""
		echo "=== Step 0: Clone safe-smart-account ==="
		step_clone_repo "${safe_version}"
	fi

	echo ""
	echo "=== Step 1: Install npm dependencies ==="
	step_npm_install

	echo ""
	echo "=== Step 2: Create .env ==="
	step_create_env

	echo ""
	echo "=== Step 3: Deploy singleton factory ==="
	step_deploy_singleton_factory

	echo ""
	echo "=== Step 4: Compile Solidity ==="
	step_compile_with_hh501_retry

	echo ""
	echo "=== Step 5: Deploy Safe contracts ==="
	step_deploy_contracts

	echo ""
	echo "=== Step 6: Update scripts/safe/constants.ts ==="
	step_update_constants

	echo ""
	echo "=== Step 7: Update src/network-config.ts ==="
	step_update_network_config

	if [[ "${skip_safe_creation}" == false ]]; then
		echo ""
		echo "=== Step 8: Create Safe wallet ==="
		step_create_safe
	else
		echo ""
		echo "=== Step 8: Skipped (--skip-safe-creation) ==="
	fi

	echo ""
	echo "=== Safe infrastructure deployment complete ==="
	echo ""
	echo "Next steps:"
	echo "  1. Start mock TX service:  bun run scripts/safe/mock-tx-service/server.ts --rpc-url ${JSON_RPC_URL}"
	echo "  2. Use eth-valctl with --safe flag"
}

main "$@"
