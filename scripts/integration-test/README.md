# Run integration tests

1. Start devnet using: `./scripts/devnet/start-kurtosis-devnet.sh`
1. Deploy safe contracts and safe wallet: `./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:8545 --safe-repo <PATH_TO_SAFE_REPO_IF_PRESENT>`
1. Start mock service: `bun run scripts/safe/mock-tx-service/server.ts`
1. Run integration tests: `./scripts/integration-test/run.sh`

## Deposit phase only

Phase J (deposit) needs neither Safe infrastructure nor the mock TX Service. It generates fresh keys with
`ethstaker-deposit-cli` (`deposit` on PATH) and deposits from `OWNER_0` (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).
Phase J sends 2 × 32 ETH and 2 × 33 ETH. The pre-flight checks fund every owner wallet below
`MIN_WALLET_BALANCE_ETH` (`constants.sh`) with `cast` from `FUNDER_PRIVATE_KEY` (default: the ethereum-package
prefunded account):

```bash
BEACON_URL=http://<host>:<beacon-port> RPC_URL=http://<host>:<rpc-port> ./scripts/integration-test/run.sh --start-from j
```

Ledger deposits on hoodi are tested manually with `manual/manual-deposit-ledger-playbook.md`.
