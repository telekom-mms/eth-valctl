# Run integration tests

1. Start devnet using: `./scripts/devnet/start-kurtosis-devnet.sh`
1. Deploy safe contracts and safe wallet: `./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:8545 --safe-repo <PATH_TO_SAFE_REPO_IF_PRESENT>`
1. Start mock service: `bun run scripts/safe/mock-tx-service/server.ts`
1. Run integration tests: `./scripts/integration-test/run.sh`
