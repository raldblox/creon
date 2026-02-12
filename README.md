# CREON

Agentic commerce built on Chainlink CRE workflows.

## Current Architecture
- Workflow runs core commerce logic in `workflow/`
- MongoDB access is handled via Next.js route `creon-store/app/api/db/[action]/route.ts`
- Next.js route connects to Atlas using `MONGODB_ATLAS_URI`
- Workflow calls the route through `MONGODB_DB_API_URL`

## Required Env
Copy `.env.example` to `.env` and set:
- `CRE_ETH_PRIVATE_KEY`
- `MONGODB_ATLAS_URI`
- `MONGODB_DATABASE`
- `MONGODB_DB_API_URL` (default `http://localhost:3000/api/db`)
- `MONGODB_DB_API_KEY` (optional)
- `ENABLE_POLICY_CHECKS` (`false` to skip OpenAI policy checks for listing)

If `ENABLE_POLICY_CHECKS=false`, `createListing` does not require OpenAI keys.

## Local Run
Start DB API server:

```bash
cd creon-store
bun install
bun run dev
```

Run workflow from repo root:

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload @./workflow/fixtures/create_listing_allow.json
```
