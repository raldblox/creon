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

## Response Shape
All actions now return a CREON result envelope with an `acp` section aligned to the Agentic Commerce Protocol.
Reference: https://agentic-commerce-protocol.com/

- `ok`, `action`, `reasonCode`, `message`, `data` (existing fields)
- `acp.version` (`2026-01-30`)
- `acp.messages[]` using Agentic Commerce Protocol message fields:
  - `type` (`info` | `warning` | `error`)
  - `code` (when mapped)
  - `content_type` (`plain`)
  - `content` (human-readable message)
- `acp.error` (only when `ok=false`) using Agentic Commerce Protocol error fields:
  - `type` (`invalid_request` | `request_not_idempotent` | `processing_error` | `service_unavailable`)
  - `code` (mapped from workflow `reasonCode`)
  - `message`

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
- `CHECK: mongodb read ok`
