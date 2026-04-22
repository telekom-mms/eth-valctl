#!/bin/bash
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_DIR}"

# shellcheck source=constants.sh
source "${SCRIPT_DIR}/constants.sh"
# shellcheck source=helpers.sh
source "${SCRIPT_DIR}/helpers.sh"

check_dependencies() {
	local missing_deps=()

	for cmd in curl jq bun deposit; do
		if ! command -v "${cmd}" &>/dev/null; then
			missing_deps+=("${cmd}")
		fi
	done

	if [[ ${#missing_deps[@]} -ne 0 ]]; then
		echo "ERROR: Missing required dependencies: ${missing_deps[*]}" >&2
		exit 1
	fi
}

preflight_checks() {
	log_phase "Pre-flight Checks"

	log_info "Checking dependencies..."
	check_dependencies
	log_info "All dependencies found"

	log_info "Checking RPC endpoint..."
	local chain_id
	chain_id=$(curl -s -X POST -H 'Content-Type: application/json' \
		-d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
		"${RPC_URL}" | jq -r .result)
	if [[ -z "${chain_id}" || "${chain_id}" == "null" ]]; then
		echo "ERROR: RPC endpoint at ${RPC_URL} is not reachable" >&2
		exit 1
	fi
	log_info "RPC chain ID: ${chain_id}"

	log_info "Checking Beacon endpoint..."
	local beacon_status
	beacon_status=$(curl -s -o /dev/null -w '%{http_code}' "${BEACON_URL}/eth/v1/node/health")
	if [[ "${beacon_status}" -ne 200 ]]; then
		echo "ERROR: Beacon endpoint at ${BEACON_URL} returned status ${beacon_status}" >&2
		exit 1
	fi
	log_info "Beacon endpoint is healthy"

	log_info "Checking Mock TX Service..."
	local tx_service_name
	tx_service_name=$(curl -s "http://localhost:5555/api/v1/about/" | jq -r .name)
	if [[ "${tx_service_name}" != "Safe Transaction Service" ]]; then
		echo "ERROR: Mock TX Service at localhost:5555 is not reachable" >&2
		exit 1
	fi
	log_info "Mock TX Service is running"

	log_info "All pre-flight checks passed"
}

setup_phase() {
	log_phase "Setup"

	mkdir -p "${TMP_DIR}"

	if range_has_bls_credentials "${SETUP_SAFE_EXTENDED_START}" "${SETUP_SAFE_EXTENDED_STOP}"; then
		log_info "Switching validators ${SETUP_SAFE_EXTENDED_START}-${SETUP_SAFE_EXTENDED_STOP} credentials to Safe address: ${SAFE_ADDRESS}"
		switch_validators_to_address "${SETUP_SAFE_EXTENDED_START}" "${SETUP_SAFE_EXTENDED_STOP}" "${SAFE_ADDRESS}"

		log_info "Waiting for credential propagation..."
		wait_for_credential_range "${SETUP_SAFE_EXTENDED_START}" "${SETUP_SAFE_EXTENDED_STOP}" "0x01" "${CREDENTIAL_WAIT_TIMEOUT}"
	else
		log_info "Validators ${SETUP_SAFE_EXTENDED_START}-${SETUP_SAFE_EXTENDED_STOP} already have credentials set"
	fi

	if range_has_bls_credentials "${SETUP_DIRECT_START}" "${SETUP_DIRECT_STOP}"; then
		log_info "Switching validators ${SETUP_DIRECT_START}-${SETUP_DIRECT_STOP} credentials to Owner 0 EOA: ${OWNER_0_ADDRESS}"
		switch_validators_to_address "${SETUP_DIRECT_START}" "${SETUP_DIRECT_STOP}" "${OWNER_0_ADDRESS}"

		log_info "Waiting for credential propagation..."
		wait_for_credential_range "${SETUP_DIRECT_START}" "${SETUP_DIRECT_STOP}" "0x01" "${CREDENTIAL_WAIT_TIMEOUT}"
	else
		log_info "Validators ${SETUP_DIRECT_START}-${SETUP_DIRECT_STOP} already have credentials set"
	fi

	log_info "Extracting pubkeys for test phases..."

	fetch_pubkeys "${SWITCH_SAFE_START}" "${SWITCH_SAFE_STOP}" "${TMP_DIR}/switch-safe-pubkeys.txt"
	fetch_pubkeys "${CONSOL_SAFE_SOURCE_START}" "${CONSOL_SAFE_SOURCE_STOP}" "${TMP_DIR}/consol-safe-sources.txt"
	fetch_pubkeys "${WITHDRAW_SAFE_START}" "${WITHDRAW_SAFE_STOP}" "${TMP_DIR}/withdraw-safe-pubkeys.txt"
	fetch_pubkeys "${EXIT_SAFE_START}" "${EXIT_SAFE_STOP}" "${TMP_DIR}/exit-safe-pubkeys.txt"
	fetch_pubkeys "${THRESHOLD_SAFE_START}" "${THRESHOLD_SAFE_STOP}" "${TMP_DIR}/threshold-safe-pubkeys.txt"
	fetch_pubkeys "${FEE_TIP_SAFE_START}" "${FEE_TIP_SAFE_STOP}" "${TMP_DIR}/fee-tip-pubkeys.txt"
	fetch_pubkeys "${FEE_SAFE_START}" "${FEE_SAFE_STOP}" "${TMP_DIR}/fee-safe-pubkeys.txt"
	fetch_pubkeys "${FEE_QUEUE_SMALL_DIRECT_START}" "${FEE_QUEUE_SMALL_DIRECT_STOP}" "${TMP_DIR}/fee-queue-small-pubkeys.txt"
	fetch_pubkeys "${FEE_QUEUE_DIRECT_START}" "${FEE_QUEUE_DIRECT_STOP}" "${TMP_DIR}/fee-queue-pubkeys.txt"

	fetch_pubkeys "${DUPLICATE_SAFE_START}" "${DUPLICATE_SAFE_STOP}" "${TMP_DIR}/duplicate-safe-pubkeys.txt"
	fetch_pubkeys "${NO_EXEC_SAFE_START}" "${NO_EXEC_SAFE_STOP}" "${TMP_DIR}/no-exec-safe-pubkeys.txt"
	fetch_pubkeys "${NONCE_GAP_SAFE_START}" "${NONCE_GAP_SAFE_STOP}" "${TMP_DIR}/nonce-gap-safe-pubkeys.txt"
	fetch_pubkeys "${FILTER_SAFE_START}" "${FILTER_SAFE_STOP}" "${TMP_DIR}/filter-safe-pubkeys.txt"

	local single_validator_pubkey
	single_validator_pubkey=$(get_pubkey_by_index "${SINGLE_VALIDATOR_SAFE}")
	echo "${single_validator_pubkey}" >"${TMP_DIR}/single-validator-pubkey.txt"

	fetch_pubkeys "${PARTIAL_FAIL_SAFE_START}" "${PARTIAL_FAIL_SAFE_STOP}" "${TMP_DIR}/partial-fail-safe-pubkeys.txt"

	fetch_pubkeys "${SWITCH_DIRECT_START}" "${SWITCH_DIRECT_STOP}" "${TMP_DIR}/switch-direct-pubkeys.txt"
	fetch_pubkeys "${CONSOL_DIRECT_SOURCE_START}" "${CONSOL_DIRECT_SOURCE_STOP}" "${TMP_DIR}/consol-direct-sources.txt"
	fetch_pubkeys "${WITHDRAW_DIRECT_START}" "${WITHDRAW_DIRECT_STOP}" "${TMP_DIR}/withdraw-direct-pubkeys.txt"
	fetch_pubkeys "${EXIT_DIRECT_START}" "${EXIT_DIRECT_STOP}" "${TMP_DIR}/exit-direct-pubkeys.txt"

	local consol_safe_target_pubkey
	consol_safe_target_pubkey=$(curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${CONSOL_SAFE_TARGET}" | jq -r .data.validator.pubkey)
	echo "${consol_safe_target_pubkey}" >"${TMP_DIR}/consol-safe-target.txt"

	local consol_direct_target_pubkey
	consol_direct_target_pubkey=$(curl -s "${BEACON_URL}/eth/v1/beacon/states/head/validators/${CONSOL_DIRECT_TARGET}" | jq -r .data.validator.pubkey)
	echo "${consol_direct_target_pubkey}" >"${TMP_DIR}/consol-direct-target.txt"

	generate_validator_report

	log_info "Setup complete"
}

phase_a_switch() {
	log_phase "A — Switch Withdrawal Credentials"

	log_test "Switch (Safe) — validators ${SWITCH_SAFE_START}-${SWITCH_SAFE_STOP}"
	safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
		switch -v "${TMP_DIR}/switch-safe-pubkeys.txt"

	log_info "Waiting for credential changes..."
	for i in $(seq "${SWITCH_SAFE_START}" "${SWITCH_SAFE_STOP}"); do
		if wait_for_credential_change "${i}" "0x02" 180; then
			log_pass "Switch (Safe) validator ${i} → 0x02"
		else
			log_fail "Switch (Safe) validator ${i} did not reach 0x02"
		fi
	done

	log_test "Switch (Direct) — validators ${SWITCH_DIRECT_START}-${SWITCH_DIRECT_STOP}"
	run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/switch-direct-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Switch (Direct) CLI output contains mined TX"

	log_info "Waiting for credential changes..."
	for i in $(seq "${SWITCH_DIRECT_START}" "${SWITCH_DIRECT_STOP}"); do
		if wait_for_credential_change "${i}" "0x02" 180; then
			log_pass "Switch (Direct) validator ${i} → 0x02"
		else
			log_fail "Switch (Direct) validator ${i} did not reach 0x02"
		fi
	done
}

phase_b_consolidation() {
	log_phase "B — Consolidation"

	local safe_target_pubkey
	safe_target_pubkey=$(cat "${TMP_DIR}/consol-safe-target.txt")

	log_test "Consolidation (Safe) — target=${CONSOL_SAFE_TARGET}, sources=${CONSOL_SAFE_SOURCE_START}-${CONSOL_SAFE_SOURCE_STOP}"

	if range_needs_credential_switch "${CONSOL_SAFE_SOURCE_START}" "${CONSOL_SAFE_SOURCE_STOP}"; then
		log_info "Switching consolidation source validators to 0x02..."
		safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
			switch -v "${TMP_DIR}/consol-safe-sources.txt"
	else
		log_info "Consolidation source validators already have 0x02 credentials"
	fi

	local consol_safe_target_file="${TMP_DIR}/consol-safe-target-switch.txt"
	echo "${safe_target_pubkey}" >"${consol_safe_target_file}"

	if needs_credential_switch "${CONSOL_SAFE_TARGET}"; then
		log_info "Switching consolidation target validator to 0x02..."
		safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
			switch -v "${consol_safe_target_file}"
	else
		log_info "Consolidation target validator already has 0x02 credentials"
	fi

	log_info "Waiting for credential changes on consolidation validators..."
	wait_for_credential_change "${CONSOL_SAFE_TARGET}" "0x02" 180
	for i in $(seq "${CONSOL_SAFE_SOURCE_START}" "${CONSOL_SAFE_SOURCE_STOP}"); do
		wait_for_credential_change "${i}" "0x02" 180
	done

	safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
		consolidate -s "${TMP_DIR}/consol-safe-sources.txt" -t "${safe_target_pubkey}"

	local direct_target_pubkey
	direct_target_pubkey=$(cat "${TMP_DIR}/consol-direct-target.txt")

	log_test "Consolidation (Direct) — target=${CONSOL_DIRECT_TARGET}, sources=${CONSOL_DIRECT_SOURCE_START}-${CONSOL_DIRECT_SOURCE_STOP}"

	if range_needs_credential_switch "${CONSOL_DIRECT_SOURCE_START}" "${CONSOL_DIRECT_SOURCE_STOP}"; then
		log_info "Switching direct consolidation source validators to 0x02..."
		run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/consol-direct-sources.txt"
		assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Consolidation (Direct) switch sources mined"
	else
		log_info "Direct consolidation source validators already have 0x02 credentials"
	fi

	local consol_direct_target_file="${TMP_DIR}/consol-direct-target-switch.txt"
	echo "${direct_target_pubkey}" >"${consol_direct_target_file}"

	if needs_credential_switch "${CONSOL_DIRECT_TARGET}"; then
		log_info "Switching direct consolidation target validator to 0x02..."
		run_ethvalctl "${OWNER_0_KEY}" switch -v "${consol_direct_target_file}"
		assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Consolidation (Direct) switch target mined"
	else
		log_info "Direct consolidation target validator already has 0x02 credentials"
	fi

	log_info "Waiting for credential changes on consolidation validators..."
	wait_for_credential_change "${CONSOL_DIRECT_TARGET}" "0x02" 180
	for i in $(seq "${CONSOL_DIRECT_SOURCE_START}" "${CONSOL_DIRECT_SOURCE_STOP}"); do
		wait_for_credential_change "${i}" "0x02" 180
	done

	run_ethvalctl "${OWNER_0_KEY}" consolidate -s "${TMP_DIR}/consol-direct-sources.txt" -t "${direct_target_pubkey}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Consolidation (Direct) CLI output contains mined TX"
}

phase_c_withdrawal() {
	log_phase "C — Partial Withdrawal"

	log_test "Partial Withdrawal (Safe) — validators ${WITHDRAW_SAFE_START}-${WITHDRAW_SAFE_STOP}"

	if range_needs_credential_switch "${WITHDRAW_SAFE_START}" "${WITHDRAW_SAFE_STOP}"; then
		log_info "Switching withdrawal validators to 0x02 first..."
		safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
			switch -v "${TMP_DIR}/withdraw-safe-pubkeys.txt"

		log_info "Waiting for credential changes..."
		for i in $(seq "${WITHDRAW_SAFE_START}" "${WITHDRAW_SAFE_STOP}"); do
			wait_for_credential_change "${i}" "0x02" 180
		done
	else
		log_info "Safe withdrawal validators already have 0x02 credentials"
	fi

	safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
		withdraw -v "${TMP_DIR}/withdraw-safe-pubkeys.txt" -a 0.001

	log_test "Partial Withdrawal (Direct) — validators ${WITHDRAW_DIRECT_START}-${WITHDRAW_DIRECT_STOP}"

	if range_needs_credential_switch "${WITHDRAW_DIRECT_START}" "${WITHDRAW_DIRECT_STOP}"; then
		log_info "Switching withdrawal validators to 0x02 first..."
		run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/withdraw-direct-pubkeys.txt"

		log_info "Waiting for credential changes..."
		for i in $(seq "${WITHDRAW_DIRECT_START}" "${WITHDRAW_DIRECT_STOP}"); do
			wait_for_credential_change "${i}" "0x02" 180
		done
	else
		log_info "Direct withdrawal validators already have 0x02 credentials"
	fi

	run_ethvalctl "${OWNER_0_KEY}" withdraw -v "${TMP_DIR}/withdraw-direct-pubkeys.txt" -a 0.001
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Partial Withdrawal (Direct) CLI output contains mined TX"
}

phase_d_exit() {
	log_phase "D — Full Exit"

	log_test "Exit (Safe) — validators ${EXIT_SAFE_START}-${EXIT_SAFE_STOP}"

	if range_needs_credential_switch "${EXIT_SAFE_START}" "${EXIT_SAFE_STOP}"; then
		log_info "Switching exit validators to 0x02 first..."
		safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
			switch -v "${TMP_DIR}/exit-safe-pubkeys.txt"

		log_info "Waiting for credential changes..."
		for i in $(seq "${EXIT_SAFE_START}" "${EXIT_SAFE_STOP}"); do
			wait_for_credential_change "${i}" "0x02" 180
		done
	else
		log_info "Safe exit validators already have 0x02 credentials"
	fi

	safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
		exit -v "${TMP_DIR}/exit-safe-pubkeys.txt"

	log_test "Exit (Direct) — validators ${EXIT_DIRECT_START}-${EXIT_DIRECT_STOP}"

	if range_needs_credential_switch "${EXIT_DIRECT_START}" "${EXIT_DIRECT_STOP}"; then
		log_info "Switching exit validators to 0x02 first..."
		run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/exit-direct-pubkeys.txt"

		log_info "Waiting for credential changes..."
		for i in $(seq "${EXIT_DIRECT_START}" "${EXIT_DIRECT_STOP}"); do
			wait_for_credential_change "${i}" "0x02" 180
		done
	else
		log_info "Direct exit validators already have 0x02 credentials"
	fi

	run_ethvalctl "${OWNER_0_KEY}" exit -v "${TMP_DIR}/exit-direct-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Exit (Direct) CLI output contains mined TX"
}

phase_e_errors() {
	log_phase "E — Error Scenarios"

	log_test "Non-owner signer with Safe"
	local random_key="0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	run_ethvalctl_safe "${random_key}" exit -v "${TMP_DIR}/withdraw-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Non-owner signer rejected"
	assert_output_contains "${LAST_CMD_OUTPUT}" "not an owner" "Non-owner error message present"

	log_test "Invalid pubkey format"
	local invalid_pubkey_file="${TMP_DIR}/invalid-pubkey.txt"
	echo "0xinvalid" >"${invalid_pubkey_file}"
	run_ethvalctl "${OWNER_0_KEY}" switch -v "${invalid_pubkey_file}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Invalid pubkey rejected"

	log_test "Wrong network"
	capture_cmd bash -c "echo '${OWNER_0_KEY}' | bun run start -n hoodi -r ${RPC_URL} -b ${BEACON_URL} switch -v ${TMP_DIR}/switch-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Wrong network rejected"
}

phase_f_threshold() {
	log_phase "F — Threshold Change"

	log_test "Propose and sign at threshold 2, then change threshold to 3"

	if range_needs_credential_switch "${THRESHOLD_SAFE_START}" "${THRESHOLD_SAFE_STOP}"; then
		log_info "Switching threshold test validators to 0x02 first..."
		safe_full_cycle "${OWNER_0_KEY}" "${OWNER_1_KEY}" "${OWNER_0_KEY}" \
			switch -v "${TMP_DIR}/threshold-safe-pubkeys.txt"

		log_info "Waiting for credential changes..."
		for i in $(seq "${THRESHOLD_SAFE_START}" "${THRESHOLD_SAFE_STOP}"); do
			wait_for_credential_change "${i}" "0x02" 180
		done
	else
		log_info "Threshold test validators already have 0x02 credentials"
	fi

	log_info "Proposing exit for threshold test validators..."
	safe_propose "${OWNER_0_KEY}" exit -v "${TMP_DIR}/threshold-safe-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "Threshold test propose output"

	log_info "Signing with owner 1 (reaching 2/2 confirmations)..."
	safe_sign "${OWNER_1_KEY}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "signed" "Threshold test sign output"

	log_info "Changing Safe threshold from 2 to 3..."
	bun run "${SCRIPT_DIR}/change-threshold.ts" --threshold 3

	log_info "Attempting safe execute with old TXs (should fail with on-chain revert)..."
	safe_execute "${OWNER_0_KEY}"

	if [[ "${LAST_CMD_EXIT_CODE}" -ne 0 ]]; then
		log_pass "Threshold change: execution failed as expected (exit code ${LAST_CMD_EXIT_CODE})"
	else
		log_fail "Threshold change: execution should have failed but succeeded"
	fi
	assert_output_contains "${LAST_CMD_OUTPUT}" "Failed to execute" "Threshold change error message present"

	log_info "Restoring Safe threshold from 3 to 2..."
	bun run "${SCRIPT_DIR}/change-threshold.ts" --threshold 2
}

phase_g_fee_validation() {
	log_phase "G — Fee Validation (Consolidation Contract)"

	# --- G.1: Fee tip proposal with output verification ---
	log_test "Fee tip — propose with --safe-fee-tip"
	safe_propose "${OWNER_0_KEY}" --safe-fee-tip 1000 switch -v "${TMP_DIR}/fee-tip-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "Fee tip propose output"
	assert_output_contains "${LAST_CMD_OUTPUT}" "tip" "Fee tip info logged in output"

	log_info "Signing fee tip transactions with owner 1..."
	safe_sign "${OWNER_1_KEY}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "signed" "Fee tip sign output"

	# --- G.2: Small queue fill + fee-tipped execution ---
	log_test "Fee tip — execute after small queue fill (tip absorbs fee growth)"
	log_info "Small queue fill: ${FEE_QUEUE_SMALL_DIRECT_START}-${FEE_QUEUE_SMALL_DIRECT_STOP} direct switches..."
	run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/fee-queue-small-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Small queue fill mined"

	log_info "Executing fee-tipped transactions..."
	safe_execute "${OWNER_0_KEY}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "executed successfully" "Fee tip execution succeeded despite queue fill"

	log_info "Waiting for credential changes on fee tip validators..."
	for i in $(seq "${FEE_TIP_SAFE_START}" "${FEE_TIP_SAFE_STOP}"); do
		if wait_for_credential_change "${i}" "0x02" 180; then
			log_pass "Fee tip validator ${i} → 0x02"
		else
			log_fail "Fee tip validator ${i} did not reach 0x02"
		fi
	done

	# --- G.3: Stale fee — propose without tip, large queue fill ---
	log_test "Stale fee — propose without tip"
	log_info "Proposing Safe switch for stale fee test validators (no tip, low fees)..."
	safe_propose "${OWNER_0_KEY}" --safe-fee-tip 0 switch -v "${TMP_DIR}/fee-safe-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "Stale fee propose output"

	log_info "Signing with owner 1..."
	safe_sign "${OWNER_1_KEY}"
	assert_output_contains "${LAST_CMD_OUTPUT}" "signed" "Stale fee sign output"

	log_info "Large queue fill: ${FEE_QUEUE_DIRECT_START}-${FEE_QUEUE_DIRECT_STOP} direct switches..."
	run_ethvalctl "${OWNER_0_KEY}" switch -v "${TMP_DIR}/fee-queue-pubkeys.txt"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Mined execution layer request" "Large queue fill mined"

	# --- G.4: Stale fee — wait action with immediate-abort budget ---
	log_test "Stale fee — wait action with --max-fee-wait-blocks 0"
	log_info "Executing with --stale-fee-action wait --max-fee-wait-blocks 0 (should detect stale and abort immediately)..."
	safe_execute "${OWNER_0_KEY}" --stale-fee-action wait --max-fee-wait-blocks 0
	assert_output_contains "${LAST_CMD_OUTPUT}" "Stale fees detected" "Wait action: stale fee summary logged"
	assert_output_contains "${LAST_CMD_OUTPUT}" "exceeds max wait" "Wait action: immediate abort logged"

	# --- G.5: Stale fee — reject action ---
	log_test "Stale fee — reject action"
	log_info "Executing with --stale-fee-action reject (should create rejection transactions)..."
	safe_execute "${OWNER_0_KEY}" --stale-fee-action reject
	assert_output_contains "${LAST_CMD_OUTPUT}" "Stale fees detected" "Reject action: stale fee summary logged"
	assert_output_contains "${LAST_CMD_OUTPUT}" "rejection transaction" "Reject action: rejection transactions proposed"
}

phase_h_safe_edge_cases() {
	log_phase "H — Safe Edge Cases"

	mock_admin_clear_pending
	wait_for_fee_decay "0x0000BBdDc7CE488642fb579F8B00f3a590007251"
	wait_for_fee_decay "0x00000961Ef480Eb55e80D19ad83579A64c007002"

	# --- H.1: Duplicate proposal (3.1) ---
	log_test "Duplicate proposal"

	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/duplicate-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "First proposal succeeds"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "First proposal output"

	mock_admin_hide_pending
	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/duplicate-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Duplicate proposal does not fail"
	assert_output_contains "${LAST_CMD_OUTPUT}" "already exists" "Duplicate proposal warning present"
	mock_admin_reset_hide_pending

	# --- H.2: Already signed (3.2) ---
	log_test "Already signed"

	safe_sign "${OWNER_1_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "First sign succeeds"
	assert_output_contains "${LAST_CMD_OUTPUT}" "signed" "First sign output"

	safe_sign "${OWNER_1_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Already-signed does not fail"
	assert_output_contains "${LAST_CMD_OUTPUT}" "already signed" "Already signed info present"

	# --- H.3: No pending transactions (5.4) ---
	log_test "No pending transactions"

	safe_execute "${OWNER_0_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Execute clears pending queue"
	assert_output_contains "${LAST_CMD_OUTPUT}" "executed successfully" "Execute output"

	safe_sign "${OWNER_1_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Sign with empty queue does not fail"
	assert_output_contains "${LAST_CMD_OUTPUT}" "No pending" "No pending transactions info"

	# --- H.4: No executable transactions (5.5) ---
	log_test "No executable transactions"

	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/no-exec-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "No-exec propose succeeds"
	assert_output_contains "${LAST_CMD_OUTPUT}" "proposed to Safe" "No-exec propose output"

	safe_execute "${OWNER_0_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Execute with unmet threshold does not fail"
	assert_output_contains "${LAST_CMD_OUTPUT}" "No executable" "No executable transactions info"

	log_info "Cleanup: signing and executing no-exec test transactions..."
	safe_sign "${OWNER_1_KEY}"
	safe_execute "${OWNER_0_KEY}"

	# --- H.5: Safe not deployed (5.2) ---
	log_test "Safe not deployed"

	local fake_safe="0x0000000000000000000000000000000000001234"
	# shellcheck disable=SC2086
	capture_cmd bash -c "echo '${OWNER_0_KEY}' | SAFE_API_KEY=${SAFE_API_KEY} bun run start -n kurtosis_devnet -r ${RPC_URL} -b ${BEACON_URL} --safe ${fake_safe} -m 3 safe sign --yes"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Fake Safe address rejected"
	assert_output_contains "${LAST_CMD_OUTPUT}" "No Safe found" "Safe not found error present"

	# --- H.6: TX Service unreachable (5.1) ---
	log_test "TX Service unreachable"

	stop_mock_tx_service

	run_ethvalctl_safe "${OWNER_0_KEY}" safe sign --yes
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Unreachable TX Service causes failure"
	assert_output_contains "${LAST_CMD_OUTPUT}" "unreachable" "TX Service unreachable error present"
	assert_output_not_contains "${LAST_CMD_OUTPUT}" "Fatal error" "TX Service unreachable shows clean error (no stack trace)"

	start_mock_tx_service
	log_info "Mock TX Service restarted"

	# --- H.7: Nonce gap detection (2.3) ---
	log_test "Nonce gap detection"

	log_info "Proposing foreign transaction (signed by owner 1 for threshold)..."
	local foreign_output
	foreign_output=$(bun run "${SCRIPT_DIR}/propose-foreign-tx.ts" --sign-with-owner1 2>"${REPORT_DIR}/propose-foreign.log")
	local foreign_nonce
	foreign_nonce=$(echo "${foreign_output}" | grep '^nonce=' | cut -d= -f2)
	local foreign_hash
	foreign_hash=$(echo "${foreign_output}" | grep '^safeTxHash=' | cut -d= -f2)
	log_info "Foreign TX: nonce=${foreign_nonce}, safeTxHash=${foreign_hash}"

	if [[ -n "${LOG_FILE}" ]]; then
		echo "Foreign TX output:" >>"${LOG_FILE}"
		log_command_output "${foreign_output}"
	fi

	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/nonce-gap-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Nonce gap: proposal succeeds at nonce N+1"

	safe_sign "${OWNER_1_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Nonce gap: sign succeeds"

	safe_execute "${OWNER_0_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Nonce gap: execute fails due to gap"
	assert_output_contains "${LAST_CMD_OUTPUT}" "lower nonces" "Nonce gap error message present"

	# --- H.8: Transaction filtering (7.1-7.3) ---
	log_test "Transaction filtering"

	safe_sign "${OWNER_1_KEY}"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Filtering: sign does not fail"
	assert_output_not_contains "${LAST_CMD_OUTPUT}" "${foreign_hash}" "Filtering: foreign TX hash not in sign output"

	safe_execute "${OWNER_0_KEY}"
	assert_output_not_contains "${LAST_CMD_OUTPUT}" "${foreign_hash}" "Filtering: foreign TX hash not in execute output"

	log_info "Cleanup: executing foreign TX on-chain to advance nonce..."
	bun run "${SCRIPT_DIR}/propose-foreign-tx.ts" --execute-hash "${foreign_hash}" 2>"${REPORT_DIR}/execute-foreign.log"

	log_info "Cleanup: executing nonce-gap eth-valctl TX..."
	safe_execute "${OWNER_0_KEY}"

	# --- H.9: Single validator — no MultiSend (9.1) ---
	log_test "Single validator (direct call, no MultiSend)"

	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/single-validator-pubkey.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Single validator propose succeeds"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Safe transaction" "Single validator: logs 'Safe transaction' (not MultiSend)"
	assert_output_not_contains "${LAST_CMD_OUTPUT}" "MultiSend" "Single validator: no MultiSend in output"

	log_info "Cleanup: signing and executing single validator TX..."
	safe_sign "${OWNER_1_KEY}"
	safe_execute "${OWNER_0_KEY}"
}

phase_i_rate_limit() {
	log_phase "I — Rate Limiting & Partial Failure"

	# --- I.1: Unauthenticated rate limit — retries (6.1) ---
	log_test "Unauthenticated rate limit retries"

	log_info "Proposing transactions for rate limit test..."
	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/filter-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Rate limit test: propose succeeds"

	log_info "Signing without API key (triggers rate limiting)..."
	run_ethvalctl_safe_no_apikey "${OWNER_1_KEY}" safe sign --yes
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 0 "Unauthenticated sign completes (retries succeed)"
	assert_output_contains "${LAST_CMD_OUTPUT}" "retrying" "Rate limit retry warning present"

	log_info "Cleanup: executing rate limit test transactions..."
	safe_execute "${OWNER_0_KEY}"

	# --- I.2: Rate limit exhausted (6.3) ---
	log_test "Rate limit exhausted"

	log_info "Setting unauthenticated rate limit to 1..."
	mock_admin_set_rate_limit 1
	mock_admin_reset_rate_limit

	run_ethvalctl_safe_no_apikey "${OWNER_0_KEY}" safe sign --yes
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Exhausted rate limit causes failure"
	assert_output_contains "${LAST_CMD_OUTPUT}" "rate limit exceeded" "Rate limit exhausted error present"

	log_info "Restoring unauthenticated rate limit to 5..."
	mock_admin_set_rate_limit 5
	mock_admin_reset_rate_limit

	# --- I.3: Partial proposal failure (9.2) ---
	log_test "Partial proposal failure"

	log_info "Setting fail-after count to 2..."
	mock_admin_set_fail_after 2

	safe_propose "${OWNER_0_KEY}" switch -v "${TMP_DIR}/partial-fail-safe-pubkeys.txt"
	assert_exit_code "${LAST_CMD_EXIT_CODE}" 1 "Partial failure causes non-zero exit"
	assert_output_contains "${LAST_CMD_OUTPUT}" "Remaining validator pubkeys" "Remaining pubkeys header present"

	mock_admin_reset_fail_after
}

cleanup() {
	log_info "Cleaning up temporary files..."
	rm -rf "${TMP_DIR}"
}

parse_start_from() {
	local phase="${1:-a}"
	phase="${phase^^}"

	case "${phase}" in
	A) echo 1 ;;
	B) echo 2 ;;
	C) echo 3 ;;
	D) echo 4 ;;
	E) echo 5 ;;
	F) echo 6 ;;
	G) echo 7 ;;
	H) echo 8 ;;
	I) echo 9 ;;
	*)
		echo "ERROR: Invalid phase '${1}'. Valid values: a, b, c, d, e, f, g, h, i" >&2
		exit 2
		;;
	esac
}

usage() {
	cat <<'EOF'
Usage: run.sh [OPTIONS]

Run eth-valctl integration tests against a Kurtosis devnet.

Options:
  --start-from <phase>    Skip phases before <phase> (default: a)
  -h, --help              Show this help message

Phases:
  a    Switch withdrawal credentials (Safe + Direct)
  b    Consolidation (Safe + Direct)
  c    Partial withdrawal (Safe + Direct)
  d    Full exit (Safe + Direct)
  e    Error scenarios (non-owner, invalid pubkey, wrong network)
  f    Threshold change (propose at 2, change to 3, verify revert)
  g    Fee validation (fee tip resilience, stale fee detection, rejection)
  h    Safe edge cases (duplicate, already signed, no pending/executable,
       not deployed, unreachable, nonce gap, filtering, single validator)
  i    Rate limiting & partial failure (unauth retries, exhausted, partial fail)

Examples:
  run.sh                     Run all phases
  run.sh --start-from c      Skip phases A and B, start from C
  run.sh --start-from g      Only run phase G (fee validation)

Prerequisites:
  - Kurtosis devnet running (1800 validators)
  - Safe infrastructure deployed (deploy-safe-infra.sh)
  - Mock TX Service running (mock-tx-service/server.ts)
EOF
	exit 0
}

main() {
	local start_from=1
	local start_from_label=""

	while [[ $# -gt 0 ]]; do
		case "$1" in
		--start-from)
			start_from=$(parse_start_from "${2:-}")
			start_from_label="${2^^}"
			shift 2
			;;
		-h | --help)
			usage
			;;
		*)
			echo "ERROR: Unknown option '$1'" >&2
			exit 2
			;;
		esac
	done

	init_log_report
	preflight_checks
	setup_phase

	if [[ "${start_from}" -le 1 ]]; then
		phase_a_switch
	else
		log_skip "Phase A — Switch (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 2 ]]; then
		phase_b_consolidation
	else
		log_skip "Phase B — Consolidation (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 3 ]]; then
		phase_c_withdrawal
	else
		log_skip "Phase C — Withdrawal (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 4 ]]; then
		phase_d_exit
	else
		log_skip "Phase D — Exit (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 5 ]]; then
		phase_e_errors
	else
		log_skip "Phase E — Errors (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 6 ]]; then
		phase_f_threshold
	else
		log_skip "Phase F — Threshold (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 7 ]]; then
		phase_g_fee_validation
	else
		log_skip "Phase G — Fee Validation (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 8 ]]; then
		phase_h_safe_edge_cases
	else
		log_skip "Phase H — Safe Edge Cases (skipped via --start-from ${start_from_label})"
	fi

	if [[ "${start_from}" -le 9 ]]; then
		phase_i_rate_limit
	else
		log_skip "Phase I — Rate Limiting & Partial Failure (skipped via --start-from ${start_from_label})"
	fi

	cleanup
	print_summary

	if [[ "${TESTS_FAILED}" -gt 0 ]]; then
		exit 1
	fi
}

main "$@"
