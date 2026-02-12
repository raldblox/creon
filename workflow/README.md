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

Each route currently returns a wiring response and logs an action checkpoint.

## Required Settings
Provide these values in `.env` for local runs (see `.env.example` at repo root
or `workflow/.env.example`) and/or in workflow secrets:
- `CRE_ETH_PRIVATE_KEY`
- `MONGODB_DATA_API_URL`
- `MONGODB_DATA_API_KEY`
- `MONGODB_DATA_SOURCE`
- `MONGODB_DATABASE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `CHAIN_GAS_LIMIT`

## Simulate
From repo root:

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload '{"input":{"action":"list"}}'
```

Expected log checkpoints include:
- `CHECK: input validated`
- `CHECK: action resolved = list`
- `CHECK: list action checkpoint`
