# eth-valctl

CLI tool for managing Ethereum validators via execution layer requests. This cli currently only supports validator related features included in the Pectra hardfork. This might change in the future. The tool is especially useful if you need to manage multiple validators at once.

Supports both private key signing (default) and Ledger hardware wallet signing via the `--ledger` flag.

**Please find the latest [release here](https://github.com/telekom-mms/eth-valctl/releases).**

## Supported networks

- Mainnet
- Hoodi
- Sepolia
- local kurtosis devnet

## Features

- Consolidate one or multiple source validators to one target validator
- Switch withdrawal credentials from type 0x01 to 0x02 (compounding) for one or multiple validators
- Partially withdraw ETH from one or many validators
- Exit one or many validators

Validator pubkeys can be provided with or without `0x` prefix.

Each command requires specific withdrawal credential types:

| Command     | Required credential type                                         |
| ----------- | ---------------------------------------------------------------- |
| switch      | Source must be `0x01` (validators with `0x02` are skipped)       |
| consolidate | Source must be at least `0x01`, target must be `0x02`            |
| withdraw    | Must be `0x02`                                                   |
| exit        | Must be `0x01` or `0x02`                                         |

**Note: When using private key signing (default), the application will request the private key during runtime. You do not need to put the secret into the start command. When using `--ledger`, ensure your Ledger device is connected with the Ethereum app open. The tool will present a paginated list of addresses derived from path `44'/60'/0'/0/x` for you to select from. Transactions are signed sequentially on the device, each requiring explicit confirmation. Batching via `--max-requests-per-block` still applies, but transactions are signed one by one.**

**Note: Your system clock must be synchronized (e.g. via NTP) for accurate slot boundary calculations. Inaccurate time may cause transactions to be broadcast at unfavorable moments, leading to reverts.**

## Available cli options and commands

Print the help message with `--help`. This works also for every subcommand.

### Global Options

| Short Option | Long Option              | Description                                                                                      |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| -n           | --network                | The network name which you want to connect to                                                    |
| -r           | --json-rpc-url           | The json rpc endpoint which is used for sending execution layer requests                         |
| -b           | --beacon-api-url         | The beacon api endpoint which is used for sanity checks like e.g.checking withdrawal credentials |
| -m           | --max-requests-per-block | The max. number of EL requests which are tried to be packaged into one block                     |
| -l           | --ledger                 | Use Ledger hardware wallet for signing (requires Ledger device with Ethereum app)                |

### Switch

| Short Option | Long Option | Description                                                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| -v           | --validator | Space separated list of validator pubkeys for which the withdrawal credential type will be changed to 0x02 |

### Consolidate

| Short Option | Long Option                   | Description                                                                                    |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| -s           | --source                      | Space separated list of validator pubkeys which will be consolidated into the target validator |
| -t           | --target                      | Target validator pubkey                                                                        |
|              | --skip-target-ownership-check | Skip the check that sender owns the target validator                                           |

### Withdraw

| Short Option | Long Option | Description                                                                              |
| ------------ | ----------- | ---------------------------------------------------------------------------------------- |
| -v           | --validator | Space separated list of validator pubkeys for which the withdrawal will be executed      |
| -a           | --amount    | Amount of ETH which will be withdrawn from the validator(s) (in ETH notation e.g. 0.001) |

### Exit

| Short Option | Long Option | Description                                                    |
| ------------ | ----------- | -------------------------------------------------------------- |
| -v           | --validator | Space separated list of validator pubkeys which will be exited |

## Transaction handling

- Transactions are processed in batches controlled by `--max-requests-per-block`
- The tool waits for the next slot boundary if signing happens in the last 2 seconds of a 12-second slot. This avoids broadcasting transactions right at a slot change where contract fees may update, and may cause brief pauses during execution.
- Failed transactions are automatically retried up to 3 times with updated contract fees
- Replacement transactions pay 12% higher transaction fees (required by execution clients for replacements to be accepted)
- Transaction replacements are mostly necessary when the system contract fees increase between signing and mining. This is especially relevant when using Ledger signing, as the manual confirmation on the device adds latency, increasing the chance of fee changes. Consider using smaller batch sizes with `--ledger` to mitigate this.
- An `INSUFFICIENT_FUNDS` error aborts all remaining batches immediately. Ensure your wallet is sufficiently funded before starting a large operation.

## Build the application

This project uses [Bun](https://bun.sh) as runtime and package manager, hence you need to install it.

You can either download a prebuilt binary for the `eth-valctl` or build it by your own.

1. Install bun: **Required bun version: >= 1.2**
1. Install dependencies

   ```bash
   bun install
   ```

1. Build and package the application

   ```bash
   # allowed build targets are
   # linux-x64, win-x64, macos-x64, linux-arm64, macos-arm64
   bun run package <YOUR_RUNNING_OS_AND_ARCHITECTURE>
   ```

1. Find the built binary in the `bin` folder

## Run local devnet

You can find a kurtosis devnet specification file in the `scripts` folder in order to run a local Ethereum devnet.

### Requirements

1. [Install docker & kurtosis](https://docs.kurtosis.com/install)

### Start your local devnet

1. Navigate to scripts folder
   - Running the start script from outside the script folder will not work since I'm working with relative paths within the script

   ```bash
   cd scripts
   ```

1. Execute the script

   ```bash
   ./start-kurtosis-devnet.sh
   ```

### Mass switch withdrawal credentials

In order to test staking related functionality you need to switch validator withdrawal credentials to type 0x01. This can be done with the script `switch-withdrawal-credentials-on-kurtosis-devnet.sh`. The script needs `curl`, `jq` and `staking-deposit-cli` as dependencies. Please find the latter [on GitHub](https://github.com/ethereum/staking-deposit-cli/releases), extract the binary and put it into `/usr/local/bin` (or equivalent on Mac):

The following is a recommended example call:

```bash
./switch-withdrawal-credentials-on-kurtosis-devnet.sh --beacon-node-url http://127.0.0.1:33006 --new-withdrawal-credentials 0x8943545177806ED17B9F23F0a21ee5948eCaa776 --validator_start_index 0 --validator_stop_index 100
```

Short explanation how to get the respective values:

- Beacon node connection url can be obtained from the local devnet with:

  ```bash
  kurtosis enclave inspect ethereum
  # Use the ports within the 5-digit range
  # These are the ones which are exposed to your localhost
  ```

- Validator start and stop index
  - all validators are created with the same mnemonic (see script)
  - so you can choose whatever range you like
  - However, I recommend to start from 0 for better overview
- For the new withdrawal credentials I recommend [this execution layer address](https://github.com/ethpandaops/ethereum-package/blob/1704194121ba25e1e845f210f248b9b5993d24c2/src/prelaunch_data_generator/genesis_constants/genesis_constants.star#L12) with [this private key](https://github.com/ethpandaops/ethereum-package/blob/1704194121ba25e1e845f210f248b9b5993d24c2/src/prelaunch_data_generator/genesis_constants/genesis_constants.star#L13). The private key will be necessary for sending execution layer requests with the `eth-valctl`.

### Inspect your testnet

The kurtosis ethereum package comes with a bunch of cool additional tools. The most important ones for you are `Dora` (Beacon chain explorer) and `Blockscout` (Execution layer explorer). Use them to check the status of transactions or how your validators behave (on consolidate, exit, etc.).

### Stop your testnet

If you want to stop your testnet just run:

```bash
kurtosis enclave stop ethereum
```

## Helper scripts

Helper scripts can be used on a local devnet but also on any other network.

### Create list of pubkeys for a range of validator indices

This can be used for testing the mass consolidation or mass withdrawal credential switch on a local devnet.

```bash
./create-public-key-list-for-consolidation.sh --beacon-node-url <BEACON_NODE_URL> --validator-start-index <VALIDATOR_START_INDEX> --validator-stop-index <VALIDATOR_STOP_INDEX>
```

### Get validator status for a range of validator indices

```bash
./get-validator-status.sh --beacon-node-url <BEACON_NODE_URL> --validator-start-index <VALIDATOR_START_INDEX> --validator-stop-index <VALIDATOR_STOP_INDEX>
```

### Get validator withdrawal credentials for a range of validator indices

```bash
./get-validator-withdrawal-credentials.sh --beacon-node-url <BEACON_NODE_URL> --validator-start-index <VALIDATOR_START_INDEX> --validator-stop-index <VALIDATOR_STOP_INDEX>
```
