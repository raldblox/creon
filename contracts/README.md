# CREON Contracts

`EntitlementRegistry` stores:
- Product lifecycle status (`ACTIVE=0`, `PAUSED=1`, `DISCONTINUED=2`, `BANNED=3`)
- Buyer entitlement by `buyer + productId`

`EntitlementRegistry` also acts as a CRE-compatible receiver contract:
- Implements `onReport(bytes metadata, bytes report)`
- Validates report sender (forwarder) and optional workflow identity filters
- Decodes report payload and routes actions:
  - `RECORD_ENTITLEMENT` (`action=0`)
  - `SET_STATUS` (`action=1`)

## Deploy (Base Sepolia)
From `contracts/`:

```bash
forge install foundry-rs/forge-std
forge script script/DeployEntitlementRegistry.s.sol:DeployEntitlementRegistry \
  --rpc-url base_sepolia \
  --broadcast
```

Required environment variables:
- `CRE_ETH_PRIVATE_KEY` (hex `0x...`)
- `CRE_FORWARDER_ADDRESS` (CRE forwarder contract address)

Deployment behavior:
- `ENTITLEMENT_OWNER` is automatically set to deployer address derived from `CRE_ETH_PRIVATE_KEY`.
- This keeps setup minimal: only private key + forwarder are required.

Current default in this repo uses bootcamp mock forwarder:
- `0x15fc6ae953e024d975e77382eeec56a9101f9f88` (Ethereum Sepolia demo value)
- Replace with official Base Sepolia forwarder before production deploy.

The script prints:
- network chain id
- deployed `EntitlementRegistry` address

Optional hardening on receiver (set expected workflow identity):
- `setExpectedAuthor(address)`
- `setExpectedWorkflowName(bytes10)`
- `setExpectedWorkflowId(bytes32)`
