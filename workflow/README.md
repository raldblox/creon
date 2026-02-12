# CREON Workflow

This workflow is organized around a single HTTP trigger entrypoint that routes by
`input.action` into `workflow/process/*`.

## Implemented Action Routes
- `createListing`
- `list`
- `search`
- `purchase`
- `restore`
- `refund`
- `governance`
- `verify`
- `decide`

Routes execute implemented workflow logic and emit `CHECK` checkpoints.

## Required Settings
Provide these values in root `.env`:
- `CRE_ETH_PRIVATE_KEY`
- `MONGODB_DB_API_URL` (default `http://localhost:3000/api/db`)
- `MONGODB_DB_API_KEY` (optional)
- `MONGODB_DATABASE`
- `MONGODB_ATLAS_URI` (used by Next.js API route, not directly by workflow)
- `ENABLE_POLICY_CHECKS` (`false` for DB-only testing)
- `OPENAI_API_KEY` (required only when `ENABLE_POLICY_CHECKS=true`)
- `OPENAI_MODEL` (required only when `ENABLE_POLICY_CHECKS=true`)
- `OPENAI_BASE_URL` (required only when `ENABLE_POLICY_CHECKS=true`)
- `CHAIN_GAS_LIMIT`
- `ENTITLEMENT_REGISTRY_ADDRESS`
- `AGENT_WALLET_ADDRESS`
- `COMMERCE_CHAIN_SELECTOR_NAME` (default: `ethereum-testnet-sepolia-base-1`)
- `COMMERCE_USDC_ADDRESS`

## Simulate
From repo root, start Next.js API first:

```bash
cd ./creon-store
bun install
bun run dev
```

Then run workflow in another shell:

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload '{"input":{"action":"list"}}'
```

Expected log checkpoints include:
- `CHECK: input validated`
- `CHECK: action resolved = list`
- `CHECK: list action checkpoint`
