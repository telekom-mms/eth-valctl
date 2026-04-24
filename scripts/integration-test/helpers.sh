#!/bin/bash

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

REPORT_DIR="./tmp/integration-test-reports"
LOG_FILE=""
VALIDATOR_REPORT_FILE=""

# --- Report functions ---

init_log_report() {
	mkdir -p "${REPORT_DIR}"
	LOG_FILE="${REPORT_DIR}/test-log.md"
	VALIDATOR_REPORT_FILE="${REPORT_DIR}/validator-state.md"

	cat >"${LOG_FILE}" <<EOF
# Integration Test Log

> Generated on $(date '+%Y-%m-%d %H:%M:%S')

EOF
}

log_section() {
	local level=$1
	local heading=$2
	local prefix=""

	for ((i = 0; i < level; i++)); do
		prefix="${prefix}#"
	done

	{
		echo ""
		echo "${prefix} ${heading}"
		echo ""
	} >>"${LOG_FILE}"
}

log_command_output() {
	local output=$1

	{
		echo '```'
		echo "${output}"
		echo '```'
		echo ""
	} >>"${LOG_FILE}"
}

truncate_pubkey() {
	local pubkey=$1
	if [[ ${#pubkey} -gt 16 ]]; then
		echo "${pubkey:0:8}...${pubkey: -4}"
	else
		echo "${pubkey}"
	fi
}

get_pubkey_by_index() {
	local index=$1
	curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${index}" | jq -r .data.validator.pubkey
}

read_pubkey_from_file() {
	local file=$1
	local line_number=$2
	sed -n "${line_number}p" "${file}"
}

write_validator_rows() {
	local file=$1
	local start_index=$2
	local phase=$3
	local operation=$4
	local expected_state=$5
	local line=1

	while IFS= read -r pubkey; do
		local index=$((start_index + line - 1))
		local short
		short=$(truncate_pubkey "${pubkey}")
		echo "| ${index} | \`${short}\` | ${phase} | ${operation} | ${expected_state} |" >>"${VALIDATOR_REPORT_FILE}"
		((line++))
	done <"${file}"
}

write_single_validator_row() {
	local index=$1
	local pubkey=$2
	local phase=$3
	local operation=$4
	local expected_state=$5
	local short
	short=$(truncate_pubkey "${pubkey}")
	echo "| ${index} | \`${short}\` | ${phase} | ${operation} | ${expected_state} |" >>"${VALIDATOR_REPORT_FILE}"
}

write_table_header() {
	{
		echo ""
		echo "| Index | Pubkey | Phase | Operation | Expected Final State |"
		echo "|-------|--------|-------|-----------|---------------------|"
	} >>"${VALIDATOR_REPORT_FILE}"
}

generate_validator_report() {
	log_info "Generating validator state report..."

	cat >"${VALIDATOR_REPORT_FILE}" <<EOF
# Validator State Table

> Generated on $(date '+%Y-%m-%d %H:%M:%S')
EOF

	# --- Safe Operations ---
	echo "" >>"${VALIDATOR_REPORT_FILE}"
	echo "## Safe Operations" >>"${VALIDATOR_REPORT_FILE}"
	write_table_header

	write_validator_rows "${TMP_DIR}/switch-safe-pubkeys.txt" \
		"${SWITCH_SAFE_START}" "A — Switch (Safe)" "switch" "credentials 0x02"

	local consol_safe_target_pubkey
	consol_safe_target_pubkey=$(cat "${TMP_DIR}/consol-safe-target.txt")
	write_single_validator_row "${CONSOL_SAFE_TARGET}" "${consol_safe_target_pubkey}" \
		"B — Consolidation (Safe)" "consolidation target" "active_ongoing (balance increased)"

	write_validator_rows "${TMP_DIR}/consol-safe-sources.txt" \
		"${CONSOL_SAFE_SOURCE_START}" "B — Consolidation (Safe)" "consolidation source" "active_exiting (balance merged into target)"

	write_validator_rows "${TMP_DIR}/withdraw-safe-pubkeys.txt" \
		"${WITHDRAW_SAFE_START}" "C — Withdrawal (Safe)" "partial withdrawal" "active_ongoing, balance reduced"

	write_validator_rows "${TMP_DIR}/exit-safe-pubkeys.txt" \
		"${EXIT_SAFE_START}" "D — Exit (Safe)" "exit" "active_exiting"

	local error_index
	for error_index in $(seq "${ERROR_SAFE_START}" "${ERROR_SAFE_STOP}"); do
		local pubkey
		pubkey=$(get_pubkey_by_index "${error_index}")
		write_single_validator_row "${error_index}" "${pubkey}" \
			"E — Errors" "error scenarios" "unchanged"
	done

	write_validator_rows "${TMP_DIR}/threshold-safe-pubkeys.txt" \
		"${THRESHOLD_SAFE_START}" "F — Threshold" "exit (reverted)" "active_ongoing (unchanged)"

	write_validator_rows "${TMP_DIR}/fee-tip-pubkeys.txt" \
		"${FEE_TIP_SAFE_START}" "G — Fee Tip (Safe)" "switch (with tip)" "credentials 0x02"

	write_validator_rows "${TMP_DIR}/fee-safe-pubkeys.txt" \
		"${FEE_SAFE_START}" "G — Fee Validation (Safe)" "switch (stale → rejected)" "active_ongoing (rejected)"

	# --- Direct Operations ---
	echo "" >>"${VALIDATOR_REPORT_FILE}"
	echo "## Direct Operations" >>"${VALIDATOR_REPORT_FILE}"
	write_table_header

	write_validator_rows "${TMP_DIR}/switch-direct-pubkeys.txt" \
		"${SWITCH_DIRECT_START}" "A — Switch (Direct)" "switch" "credentials 0x02"

	local consol_direct_target_pubkey
	consol_direct_target_pubkey=$(cat "${TMP_DIR}/consol-direct-target.txt")
	write_single_validator_row "${CONSOL_DIRECT_TARGET}" "${consol_direct_target_pubkey}" \
		"B — Consolidation (Direct)" "consolidation target" "active_ongoing (balance increased)"

	write_validator_rows "${TMP_DIR}/consol-direct-sources.txt" \
		"${CONSOL_DIRECT_SOURCE_START}" "B — Consolidation (Direct)" "consolidation source" "active_exiting (balance merged into target)"

	write_validator_rows "${TMP_DIR}/withdraw-direct-pubkeys.txt" \
		"${WITHDRAW_DIRECT_START}" "C — Withdrawal (Direct)" "partial withdrawal" "active_ongoing, balance reduced"

	write_validator_rows "${TMP_DIR}/exit-direct-pubkeys.txt" \
		"${EXIT_DIRECT_START}" "D — Exit (Direct)" "exit" "active_exiting"

	# --- Support Validators ---
	echo "" >>"${VALIDATOR_REPORT_FILE}"
	echo "## Support Validators" >>"${VALIDATOR_REPORT_FILE}"
	write_table_header

	write_validator_rows "${TMP_DIR}/fee-queue-small-pubkeys.txt" \
		"${FEE_QUEUE_SMALL_DIRECT_START}" "G — Fee Tip" "small queue filler (direct switch)" "credentials 0x02"

	write_validator_rows "${TMP_DIR}/fee-queue-pubkeys.txt" \
		"${FEE_QUEUE_DIRECT_START}" "G — Fee Validation" "queue filler (direct switch)" "credentials 0x02"

	log_info "Validator state report written to ${VALIDATOR_REPORT_FILE}"
}

# --- Logging functions ---

log_phase() {
	local msg=""
	msg+=$'\n'
	msg+="============================================"
	msg+=$'\n'
	msg+="  PHASE: $1"
	msg+=$'\n'
	msg+="============================================"
	msg+=$'\n'
	echo "${msg}"
	if [[ -n "${LOG_FILE}" ]]; then
		log_section 2 "Phase $1"
	fi
}

log_test() {
	echo "--- TEST: $1 ---"
	if [[ -n "${LOG_FILE}" ]]; then
		log_section 3 "$1"
	fi
}

log_pass() {
	local text="  ✓ PASS: $1"
	echo "${text}"
	TESTS_PASSED=$((TESTS_PASSED + 1))
	if [[ -n "${LOG_FILE}" ]]; then
		echo "**✓ PASS:** $1" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
}

log_fail() {
	local text="  ✗ FAIL: $1"
	echo "${text}"
	TESTS_FAILED=$((TESTS_FAILED + 1))
	if [[ -n "${LOG_FILE}" ]]; then
		echo "**✗ FAIL:** $1" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
}

log_skip() {
	echo "  ⊘ SKIP: $1"
	TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
	if [[ -n "${LOG_FILE}" ]]; then
		echo "**⊘ SKIP:** $1" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
}

log_info() {
	echo "  ℹ $1"
}

print_summary() {
	local summary=""
	summary+=$'\n'
	summary+="============================================"
	summary+=$'\n'
	summary+="  TEST SUMMARY"
	summary+=$'\n'
	summary+="============================================"
	summary+=$'\n'
	summary+="  Passed:  ${TESTS_PASSED}"
	summary+=$'\n'
	summary+="  Failed:  ${TESTS_FAILED}"
	summary+=$'\n'
	summary+="  Skipped: ${TESTS_SKIPPED}"
	summary+=$'\n'
	summary+="  Total:   $((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))"
	summary+=$'\n'
	summary+="============================================"
	summary+=$'\n'
	echo "${summary}"

	if [[ -n "${LOG_FILE}" ]]; then
		{
			echo ""
			echo "## Test Summary"
			echo ""
			echo "| Result | Count |"
			echo "|--------|-------|"
			echo "| Passed | ${TESTS_PASSED} |"
			echo "| Failed | ${TESTS_FAILED} |"
			echo "| Skipped | ${TESTS_SKIPPED} |"
			echo "| **Total** | **$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))** |"
		} >>"${LOG_FILE}"

		log_info "Test log written to ${LOG_FILE}"
		log_info "Validator state report at ${VALIDATOR_REPORT_FILE}"
	fi
}

# --- Beacon API helpers ---

fetch_pubkeys() {
	local start=$1
	local stop=$2
	local output_file=$3

	"${DEVNET_SCRIPTS_DIR}/create-public-key-list-for-consolidation.sh" \
		--beacon-node-url "${BEACON_URL}" \
		--validator-start-index "${start}" \
		--validator-stop-index "${stop}" \
		--file "${output_file}"
}

get_credential_prefix() {
	local index=$1
	local cred
	cred=$(curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${index}" | jq -r .data.validator.withdrawal_credentials)
	echo "${cred:0:4}"
}

needs_credential_switch() {
	local index=$1
	local cred
	cred=$(get_credential_prefix "${index}")
	[[ "${cred}" != "0x02" ]]
}

range_needs_credential_switch() {
	local start=$1
	local stop=$2
	for i in $(seq "${start}" "${stop}"); do
		if needs_credential_switch "${i}"; then
			return 0
		fi
	done
	return 1
}

range_has_bls_credentials() {
	local start=$1
	local stop=$2
	for i in $(seq "${start}" "${stop}"); do
		local cred
		cred=$(get_credential_prefix "${i}")
		if [[ "${cred}" == "0x00" ]]; then
			return 0
		fi
	done
	return 1
}

get_validator_status() {
	local index=$1
	curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${index}" | jq -r .data.status
}

wait_for_credential_change() {
	local index=$1
	local expected_prefix=$2
	local timeout=${3:-${CREDENTIAL_WAIT_TIMEOUT}}
	local deadline=$((SECONDS + timeout))

	while ((SECONDS < deadline)); do
		local current
		current=$(get_credential_prefix "${index}")
		if [[ "${current}" == "${expected_prefix}" ]]; then
			return 0
		fi
		sleep "${CREDENTIAL_POLL_INTERVAL}"
	done

	echo "Timeout waiting for validator ${index} to reach credential prefix ${expected_prefix}" >&2
	return 1
}

wait_for_status_change() {
	local index=$1
	local expected_status=$2
	local timeout=${3:-${STATUS_WAIT_TIMEOUT}}
	local deadline=$((SECONDS + timeout))

	while ((SECONDS < deadline)); do
		local current
		current=$(get_validator_status "${index}")
		if [[ "${current}" == "${expected_status}" ]]; then
			return 0
		fi
		sleep "${CREDENTIAL_POLL_INTERVAL}"
	done

	echo "Timeout waiting for validator ${index} to reach status ${expected_status}" >&2
	return 1
}

# --- Command capture ---

LAST_CMD_OUTPUT=""
# shellcheck disable=SC2034
LAST_CMD_EXIT_CODE=0

capture_cmd() {
	local output
	set +e
	output=$("$@" 2>&1)
	# shellcheck disable=SC2034
	LAST_CMD_EXIT_CODE=$?
	set -e
	LAST_CMD_OUTPUT="${output}"

	if [[ -n "${LOG_FILE}" ]]; then
		log_command_output "${output}"
	fi
}

# --- eth-valctl wrappers ---

run_ethvalctl() {
	local private_key=$1
	shift
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${private_key}' | ${DIRECT_BASE_CMD} $*"
}

run_ethvalctl_safe() {
	local private_key=$1
	shift
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${private_key}' | ${SAFE_BASE_CMD} $*"
}

safe_propose() {
	local private_key=$1
	shift
	run_ethvalctl_safe "${private_key}" "$@"
}

safe_sign() {
	local private_key=$1
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${private_key}' | ${SAFE_BASE_CMD} safe sign --yes"
}

safe_execute() {
	local private_key=$1
	shift
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${private_key}' | ${SAFE_BASE_CMD} safe execute --yes $*"
}

safe_full_cycle() {
	local proposer_key=$1
	local signer_key=$2
	local executor_key=$3
	shift 3

	log_info "Proposing..."
	if [[ -n "${LOG_FILE}" ]]; then
		echo "#### Propose" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
	safe_propose "${proposer_key}" "$@"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "Propose output contains proposal confirmation"

	log_info "Signing..."
	if [[ -n "${LOG_FILE}" ]]; then
		echo "#### Sign" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
	safe_sign "${signer_key}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "signed" "Sign output contains signing confirmation"

	log_info "Executing..."
	if [[ -n "${LOG_FILE}" ]]; then
		echo "#### Execute" >>"${LOG_FILE}"
		echo "" >>"${LOG_FILE}"
	fi
	safe_execute "${executor_key}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "executed successfully" "Execute output contains execution confirmation"
}

# --- Credential switch helper ---

switch_validators_to_address() {
	local start=$1
	local stop=$2
	local target_address=$3

	"${DEVNET_SCRIPTS_DIR}/switch-withdrawal-credentials-on-kurtosis-devnet.sh" \
		--beacon-node-url "${BEACON_URL}" \
		--new-withdrawal-credentials "${target_address}" \
		--validator-start-index "${start}" \
		--validator-stop-index "${stop}"
}

wait_for_credential_range() {
	local start=$1
	local stop=$2
	local expected_prefix=$3
	local timeout=${4:-${CREDENTIAL_WAIT_TIMEOUT}}

	log_info "Waiting for validators ${start}-${stop} to reach credential prefix ${expected_prefix}..."

	for i in $(seq "${start}" "${stop}"); do
		if ! wait_for_credential_change "${i}" "${expected_prefix}" "${timeout}"; then
			log_fail "Validator ${i} did not reach credential prefix ${expected_prefix} within timeout"
			return 1
		fi
	done

	log_info "All validators ${start}-${stop} have credential prefix ${expected_prefix}"
	return 0
}

# --- Assertion helpers ---

assert_exit_code() {
	local actual=$1
	local expected=$2
	local description=$3

	if [[ "${actual}" -eq "${expected}" ]]; then
		log_pass "${description} (exit code ${actual})"
		return 0
	else
		log_fail "${description} (expected exit code ${expected}, got ${actual})"
		return 1
	fi
}

assert_credential_prefix() {
	local index=$1
	local expected_prefix=$2
	local description=$3
	local actual
	actual=$(get_credential_prefix "${index}")

	if [[ "${actual}" == "${expected_prefix}" ]]; then
		log_pass "${description} (validator ${index} has ${expected_prefix})"
		return 0
	else
		log_fail "${description} (validator ${index}: expected ${expected_prefix}, got ${actual})"
		return 1
	fi
}

assert_status() {
	local index=$1
	local expected_status=$2
	local description=$3
	local actual
	actual=$(get_validator_status "${index}")

	if [[ "${actual}" == "${expected_status}" ]]; then
		log_pass "${description} (validator ${index} is ${expected_status})"
		return 0
	else
		log_fail "${description} (validator ${index}: expected ${expected_status}, got ${actual})"
		return 1
	fi
}

assert_output_contains() {
	local output=$1
	local pattern=$2
	local description=$3

	if echo "${output}" | grep -q "${pattern}"; then
		log_pass "${description}"
		return 0
	else
		log_fail "${description} (output did not contain '${pattern}')"
		return 1
	fi
}

assert_output_not_contains() {
	local output=$1
	local pattern=$2
	local description=$3

	if echo "${output}" | grep -q "${pattern}"; then
		log_fail "${description} (output unexpectedly contained '${pattern}')"
		return 1
	else
		log_pass "${description}"
		return 0
	fi
}

# --- No-API-key Safe wrapper ---

run_ethvalctl_safe_no_apikey() {
	local private_key=$1
	shift
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${private_key}' | ${SAFE_BASE_CMD_NO_APIKEY} $*"
}

# --- Mock admin wrappers ---

mock_admin_set_rate_limit() {
	local limit=$1
	curl -s -X POST -H 'Content-Type: application/json' \
		-d "{\"unauthenticatedLimit\": ${limit}}" \
		"${MOCK_ADMIN_URL}/rate-limit" >/dev/null
}

mock_admin_reset_rate_limit() {
	curl -s -X POST "${MOCK_ADMIN_URL}/rate-limit/reset" >/dev/null
}

mock_admin_set_fail_after() {
	local count=$1
	curl -s -X POST -H 'Content-Type: application/json' \
		-d "{\"count\": ${count}}" \
		"${MOCK_ADMIN_URL}/fail-after" >/dev/null
}

mock_admin_reset_fail_after() {
	curl -s -X POST "${MOCK_ADMIN_URL}/fail-after/reset" >/dev/null
}

mock_admin_hide_pending() {
	curl -s -X POST "${MOCK_ADMIN_URL}/hide-pending" >/dev/null
}

mock_admin_reset_hide_pending() {
	curl -s -X POST "${MOCK_ADMIN_URL}/hide-pending/reset" >/dev/null
}

mock_admin_clear_pending() {
	curl -s -X POST "${MOCK_ADMIN_URL}/clear-pending" >/dev/null
}

# --- Fee decay helper ---

wait_for_fee_decay() {
	local contract_address=$1
	local max_excess=12
	local waited=false

	while true; do
		local excess_hex
		excess_hex=$(curl -s -X POST -H 'Content-Type: application/json' \
			-d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getStorageAt\",\"params\":[\"${contract_address}\",\"0x0\",\"latest\"],\"id\":1}" \
			"${RPC_URL}" | jq -r .result)

		local excess_dec
		excess_dec=$((excess_hex))

		if [[ "${excess_dec}" -le "${max_excess}" ]]; then
			if [[ "${waited}" == true ]]; then
				log_info "System contract fee at minimum (excess=${excess_dec}, fee=1 wei)"
			fi
			return 0
		fi

		if [[ "${waited}" == false ]]; then
			log_info "Waiting for system contract ${contract_address} fee to decay to minimum..."
			waited=true
		fi

		local blocks_remaining=$((excess_dec - max_excess))
		local minutes_remaining=$((blocks_remaining * 12 / 60))
		log_info "Fee excess=${excess_dec}, ~${minutes_remaining} min remaining..."
		sleep 12
	done
}

# --- Mock TX Service lifecycle ---

stop_mock_tx_service() {
	pkill -f "mock-tx-service/server.ts" 2>/dev/null || true

	local attempts=0
	local max_attempts=10
	while [[ "${attempts}" -lt "${max_attempts}" ]]; do
		if ! curl -s "http://localhost:5555/api/v1/about/" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
		((attempts++))
	done

	pkill -9 -f "mock-tx-service/server.ts" 2>/dev/null || true
	sleep 1
}

start_mock_tx_service() {
	log_info "Starting mock TX service (pwd=$(pwd))..."
	bun run scripts/safe/mock-tx-service/server.ts >"${REPORT_DIR}/mock-tx-service.log" 2>&1 &
	local mock_pid=$!
	log_info "Mock TX service process started (pid=${mock_pid})"
	if ! wait_for_mock_tx_service; then
		log_info "Mock TX service log contents:"
		cat "${REPORT_DIR}/mock-tx-service.log" >&2
		return 1
	fi
}

wait_for_mock_tx_service() {
	local attempts=0
	local max_attempts=30
	while [[ "${attempts}" -lt "${max_attempts}" ]]; do
		if curl -s "http://localhost:5555/api/v1/about/" | grep -q "Safe Transaction Service" 2>/dev/null; then
			log_info "Mock TX service is responding (attempt $((attempts + 1)))"
			return 0
		fi
		((attempts++))
		sleep 1
	done
	log_info "ERROR: Mock TX Service did not start within ${max_attempts}s"
	return 1
}
