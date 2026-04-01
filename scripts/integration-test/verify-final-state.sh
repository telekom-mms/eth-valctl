#!/bin/bash
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_DIR}"

# shellcheck source=constants.sh
source "${SCRIPT_DIR}/constants.sh"

TIMEOUT=${TIMEOUT:-600}
POLL_INTERVAL=${POLL_INTERVAL:-12}
REPORT_DIR="./tmp/integration-test-reports"
REPORT_FILE="${REPORT_DIR}/final-state-verification.md"

PASSED=0
FAILED=0

# --- Beacon API helpers ---

get_validator_state() {
	local index=$1
	curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${index}"
}

get_status() {
	local index=$1
	get_validator_state "${index}" | jq -r .data.status
}

get_credential_prefix() {
	local index=$1
	local cred
	cred=$(get_validator_state "${index}" | jq -r .data.validator.withdrawal_credentials)
	echo "${cred:0:4}"
}

# --- Verification helpers ---

check_pass() {
	local description=$1
	echo "  ✓ ${description}"
	echo "| ✓ | ${description} |" >>"${REPORT_FILE}"
	((PASSED++))
}

check_fail() {
	local description=$1
	echo "  ✗ ${description}"
	echo "| ✗ | ${description} |" >>"${REPORT_FILE}"
	((FAILED++))
}

verify_status() {
	local index=$1
	local expected=$2
	local label=$3
	local actual
	actual=$(get_status "${index}")

	if [[ "${actual}" == "${expected}" ]]; then
		check_pass "${label}: validator ${index} is ${actual}"
	else
		check_fail "${label}: validator ${index} expected ${expected}, got ${actual}"
	fi
}

verify_credential() {
	local index=$1
	local expected_prefix=$2
	local label=$3
	local actual
	actual=$(get_credential_prefix "${index}")

	if [[ "${actual}" == "${expected_prefix}" ]]; then
		check_pass "${label}: validator ${index} has credentials ${actual}"
	else
		check_fail "${label}: validator ${index} expected credentials ${expected_prefix}, got ${actual}"
	fi
}

verify_range_status() {
	local start=$1
	local stop=$2
	local expected=$3
	local label=$4

	for i in $(seq "${start}" "${stop}"); do
		verify_status "${i}" "${expected}" "${label}"
	done
}

verify_range_credentials() {
	local start=$1
	local stop=$2
	local expected_prefix=$3
	local label=$4

	for i in $(seq "${start}" "${stop}"); do
		verify_credential "${i}" "${expected_prefix}" "${label}"
	done
}

# --- Wait for a range to reach expected status ---

wait_for_range() {
	local start=$1
	local stop=$2
	local expected=$3
	local label=$4
	local deadline=$((SECONDS + TIMEOUT))

	echo "  ⏳ Waiting for validators ${start}-${stop} to reach ${expected} (timeout: ${TIMEOUT}s)..."

	local pending=()
	for i in $(seq "${start}" "${stop}"); do
		pending+=("${i}")
	done

	while ((SECONDS < deadline)) && [[ ${#pending[@]} -gt 0 ]]; do
		local still_pending=()
		for i in "${pending[@]}"; do
			local actual
			actual=$(get_status "${i}")
			if [[ "${actual}" != "${expected}" ]]; then
				still_pending+=("${i}")
			fi
		done
		pending=("${still_pending[@]+"${still_pending[@]}"}")

		if [[ ${#pending[@]} -gt 0 ]]; then
			echo "  ⏳ ${#pending[@]} validators still transitioning..."
			sleep "${POLL_INTERVAL}"
		fi
	done

	for i in $(seq "${start}" "${stop}"); do
		verify_status "${i}" "${expected}" "${label}"
	done
}

wait_for_single() {
	local index=$1
	local expected=$2
	local label=$3
	local deadline=$((SECONDS + TIMEOUT))

	while ((SECONDS < deadline)); do
		local actual
		actual=$(get_status "${index}")
		if [[ "${actual}" == "${expected}" ]]; then
			break
		fi
		sleep "${POLL_INTERVAL}"
	done

	verify_status "${index}" "${expected}" "${label}"
}

# --- Report setup ---

init_report() {
	mkdir -p "${REPORT_DIR}"
	cat >"${REPORT_FILE}" <<EOF
# Final State Verification

> Generated on $(date '+%Y-%m-%d %H:%M:%S')
> Timeout: ${TIMEOUT}s | Poll interval: ${POLL_INTERVAL}s

| Result | Description |
|--------|-------------|
EOF
}

print_summary() {
	local total=$((PASSED + FAILED))

	{
		echo ""
		echo "## Summary"
		echo ""
		echo "| Result | Count |"
		echo "|--------|-------|"
		echo "| Passed | ${PASSED} |"
		echo "| Failed | ${FAILED} |"
		echo "| **Total** | **${total}** |"
	} >>"${REPORT_FILE}"

	echo ""
	echo "============================================"
	echo "  VERIFICATION SUMMARY"
	echo "============================================"
	echo "  Passed: ${PASSED}"
	echo "  Failed: ${FAILED}"
	echo "  Total:  ${total}"
	echo "============================================"
	echo ""
	echo "Report written to ${REPORT_FILE}"
}

# --- Main verification ---

main() {
	echo "=== Final State Verification ==="
	echo "Beacon URL: ${BEACON_URL}"
	echo "Timeout: ${TIMEOUT}s"
	echo ""

	init_report

	echo "--- Switch (Safe) — validators ${SWITCH_SAFE_START}-${SWITCH_SAFE_STOP} ---"
	verify_range_credentials "${SWITCH_SAFE_START}" "${SWITCH_SAFE_STOP}" "0x02" "Switch (Safe)"

	echo "--- Switch (Direct) — validators ${SWITCH_DIRECT_START}-${SWITCH_DIRECT_STOP} ---"
	verify_range_credentials "${SWITCH_DIRECT_START}" "${SWITCH_DIRECT_STOP}" "0x02" "Switch (Direct)"

	echo "--- Consolidation (Safe) — target ${CONSOL_SAFE_TARGET} ---"
	verify_status "${CONSOL_SAFE_TARGET}" "active_ongoing" "Consolidation target (Safe)"
	verify_credential "${CONSOL_SAFE_TARGET}" "0x02" "Consolidation target (Safe)"

	echo "--- Consolidation (Safe) — sources ${CONSOL_SAFE_SOURCE_START}-${CONSOL_SAFE_SOURCE_STOP} ---"
	wait_for_range "${CONSOL_SAFE_SOURCE_START}" "${CONSOL_SAFE_SOURCE_STOP}" \
		"exited_unslashed" "Consolidation source (Safe)"

	echo "--- Consolidation (Direct) — target ${CONSOL_DIRECT_TARGET} ---"
	verify_status "${CONSOL_DIRECT_TARGET}" "active_ongoing" "Consolidation target (Direct)"
	verify_credential "${CONSOL_DIRECT_TARGET}" "0x02" "Consolidation target (Direct)"

	echo "--- Consolidation (Direct) — sources ${CONSOL_DIRECT_SOURCE_START}-${CONSOL_DIRECT_SOURCE_STOP} ---"
	wait_for_range "${CONSOL_DIRECT_SOURCE_START}" "${CONSOL_DIRECT_SOURCE_STOP}" \
		"exited_unslashed" "Consolidation source (Direct)"

	echo "--- Withdrawal (Safe) — validators ${WITHDRAW_SAFE_START}-${WITHDRAW_SAFE_STOP} ---"
	verify_range_status "${WITHDRAW_SAFE_START}" "${WITHDRAW_SAFE_STOP}" \
		"active_ongoing" "Withdrawal (Safe)"

	echo "--- Withdrawal (Direct) — validators ${WITHDRAW_DIRECT_START}-${WITHDRAW_DIRECT_STOP} ---"
	verify_range_status "${WITHDRAW_DIRECT_START}" "${WITHDRAW_DIRECT_STOP}" \
		"active_ongoing" "Withdrawal (Direct)"

	echo "--- Exit (Safe) — validators ${EXIT_SAFE_START}-${EXIT_SAFE_STOP} ---"
	wait_for_range "${EXIT_SAFE_START}" "${EXIT_SAFE_STOP}" \
		"exited_unslashed" "Exit (Safe)"

	echo "--- Exit (Direct) — validators ${EXIT_DIRECT_START}-${EXIT_DIRECT_STOP} ---"
	wait_for_range "${EXIT_DIRECT_START}" "${EXIT_DIRECT_STOP}" \
		"exited_unslashed" "Exit (Direct)"

	echo "--- Error validators ${ERROR_SAFE_START}-${ERROR_SAFE_STOP} ---"
	verify_range_status "${ERROR_SAFE_START}" "${ERROR_SAFE_STOP}" \
		"active_ongoing" "Error scenarios"

	echo "--- Threshold validators ${THRESHOLD_SAFE_START}-${THRESHOLD_SAFE_STOP} ---"
	verify_range_status "${THRESHOLD_SAFE_START}" "${THRESHOLD_SAFE_STOP}" \
		"active_ongoing" "Threshold (reverted)"

	echo "--- Fee tip (Safe) — validators ${FEE_TIP_SAFE_START}-${FEE_TIP_SAFE_STOP} ---"
	verify_range_credentials "${FEE_TIP_SAFE_START}" "${FEE_TIP_SAFE_STOP}" "0x02" "Fee tip (Safe)"

	echo "--- Fee validation (Safe) — validators ${FEE_SAFE_START}-${FEE_SAFE_STOP} ---"
	verify_range_status "${FEE_SAFE_START}" "${FEE_SAFE_STOP}" \
		"active_ongoing" "Fee validation (rejected)"

	echo "--- Small queue fillers (Direct) — validators ${FEE_QUEUE_SMALL_DIRECT_START}-${FEE_QUEUE_SMALL_DIRECT_STOP} ---"
	verify_range_credentials "${FEE_QUEUE_SMALL_DIRECT_START}" "${FEE_QUEUE_SMALL_DIRECT_STOP}" "0x02" "Small queue filler (Direct)"

	echo "--- Queue fillers (Direct) — validators ${FEE_QUEUE_DIRECT_START}-${FEE_QUEUE_DIRECT_STOP} ---"
	wait_for_range "${FEE_QUEUE_DIRECT_START}" "${FEE_QUEUE_DIRECT_STOP}" \
		"exited_unslashed" "Queue filler exit (Direct)"

	print_summary

	if [[ "${FAILED}" -gt 0 ]]; then
		exit 1
	fi
}

main "$@"
