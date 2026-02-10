---
description: Update Ethereum client versions in devnet configuration
argument-hint: Optional filter (e.g., "geth", "lighthouse", "el", "cl", or leave empty for all)
---

You are an Ethereum devnet configuration specialist. Update the client image tags in the devnet configuration files.

**You need to crawl the internet and dockerhub specifically for your task. You MUST use exa tools (crawling_exa, web_search_exa, get_code_context_exa) as defined in your global rules.**

## Target Files

- **Tags file**: `scripts/devnet/ethereum-devnet-tags.env`
- **Config reference**: `scripts/devnet/ethereum-devnet.yaml`

## Client Registry

### Execution Layer (EL) Clients

| Client | Variable | Docker Registry |
| ------ | -------- | --------------- |
| Geth | `GETH_IMAGE_TAG` | `ethereum/client-go` (Docker Hub) |
| Nethermind | `NETHERMIND_IMAGE_TAG` | `nethermind/nethermind` (Docker Hub) |
| Besu | `BESU_IMAGE_TAG` | `hyperledger/besu` (Docker Hub) |
| Reth | `RETH_IMAGE_TAG` | `ghcr.io/paradigmxyz/reth` (GitHub Container Registry) |

### Consensus Layer (CL) Clients

| Client | Variable | Docker Registry |
| ------ | -------- | --------------- |
| Teku | `TEKU_IMAGE_TAG` | `consensys/teku` (Docker Hub) |
| Lighthouse | `LIGHTHOUSE_IMAGE_TAG` | `sigp/lighthouse` (Docker Hub) |
| Nimbus | `NIMBUS_IMAGE_TAG` | `statusim/nimbus-eth2` (Docker Hub) |
| Lodestar | `LODESTAR_IMAGE_TAG` | `chainsafe/lodestar` (Docker Hub) |

## Instructions

1. **Parse the filter argument** (if provided): $ARGUMENTS
   - `el` - Update only Execution Layer clients
   - `cl` - Update only Consensus Layer clients
   - `<client-name>` - Update specific client (e.g., `geth`, `lighthouse`)
   - Empty/all - Update all clients

2. **Read current versions** from `scripts/devnet/ethereum-devnet-tags.env`

3. **For each client to update**, fetch the latest stable release tag:

   **Docker Hub images** (geth, nethermind, besu, teku, lighthouse, nimbus, lodestar):
   - Use exa tools to find the latest release version from the official GitHub releases page or Docker Hub
   - Search query example: `"ethereum/client-go latest release version docker"`

   **GitHub Container Registry** (reth):
   - Search for latest release from `https://github.com/paradigmxyz/reth/releases`

4. **Version format rules**:
   - Geth: `v1.x.x` format (includes `v` prefix)
   - Nethermind: `1.x.x` format (no `v` prefix)
   - Besu: `xx.x.x` format (no `v` prefix)
   - Reth: `v1.x.x` format (includes `v` prefix)
   - Teku: `xx.x.x` format (no `v` prefix)
   - Lighthouse: `v7.x.x` format (includes `v` prefix)
   - Nimbus: `amd64-vxx.x.x` format (architecture prefix + `v`)
   - Lodestar: `v1.x.x` format (includes `v` prefix)

5. **Compare versions** and report:
   - Current version
   - Latest version found
   - Whether update is needed

6. **Update the tags file** with new versions (only changed ones)

7. **Summary output**:
   - List all updated clients with old → new version
   - List clients already at latest version
   - Note any clients where version lookup failed

## Important Notes

- Only update to stable releases, not pre-releases or nightly builds
- Preserve the file format and comments in `ethereum-devnet-tags.env`
- If a version lookup fails, report the error but continue with other clients
- Consider that some clients may have architecture-specific tags (like Nimbus with `amd64-` prefix)

## Example Output

```text
Checking Ethereum client versions...

EL Clients:
  ✓ Geth: v1.16.4 → v1.16.5 (updated)
  - Nethermind: 1.34.0 (already latest)
  ✓ Besu: 25.9.0 → 25.10.0 (updated)
  - Reth: v1.8.2 (already latest)

CL Clients:
  - Teku: 25.9.3 (already latest)
  ✓ Lighthouse: v7.1.0 → v7.2.0 (updated)
  - Nimbus: amd64-v25.9.2 (already latest)
  - Lodestar: v1.34.1 (already latest)

Updated scripts/devnet/ethereum-devnet-tags.env
```
