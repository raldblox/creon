# CREON

Agentic commerce built on Chainlink CRE workflows.

## Current Architecture
- Workflow runs core commerce logic in `workflow/`
- MongoDB access is handled via Next.js route `creon-store/app/api/db/[action]/route.ts`
- Next.js route connects to Atlas using `MONGODB_ATLAS_URI`
- Workflow calls the route through `MONGODB_DB_API_URL`
- Workflow responses include an `acp` envelope aligned with the Agentic Commerce Protocol (a standard response format for agent-driven checkout and commerce flows): https://agentic-commerce-protocol.com/

## Workflow Coverage
Current workflow actions in `workflow/process/*`:
- `createListing`: create a product listing, optionally run policy checks, then write to MongoDB.
- `list`: list products from MongoDB (`ACTIVE` and non-banned by default).
- `search`: text and tag search over listings.
- `purchase`: verify payment proof, enforce pricing/fee rules, detect duplicates, write purchase + entitlement, and record onchain entitlement.
- `restore`: validate ownership and product status before restore.
- `refund`: allow refunds only for duplicate purchase of same `buyer + productId` with entitlement checks.
- `governance`: update product lifecycle status (`ACTIVE`, `PAUSED`, `DISCONTINUED`, `BANNED`).
- `verify`: normalize payment proof and return canonical payment metadata.
- `decide`: generic allow/deny decision route for agent orchestration.

## Required Env
Copy `.env.example` to `.env` and set:
- `CRE_ETH_PRIVATE_KEY`
- `MONGODB_ATLAS_URI`
- `MONGODB_DATABASE`
- `MONGODB_DB_API_URL` (default `http://localhost:3000/api/db`)
- `MONGODB_DB_API_KEY` (optional)
- `ENABLE_POLICY_CHECKS` (`false` to skip OpenAI policy checks for listing)

If `ENABLE_POLICY_CHECKS=false`, `createListing` does not require OpenAI keys.

## OpenAI LLM Usage
The OpenAI model is used in `createListing` for policy classification when
`ENABLE_POLICY_CHECKS=true`.

What it does:
- Runs deterministic checks first.
- Sends listing context to OpenAI (`workflow/integration/openai.ts`) for risk classification.
- Returns `complianceFlags`, `riskTier`, `recommendedPolicy`, and `confidence`.
- Denies listing when the model returns `recommendedPolicy = deny`.

Required env for LLM path:
- `ENABLE_POLICY_CHECKS=true`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-4o-mini`)
- `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
- `OPENAI_API_KEY` can be set in `.env` or as workflow secret `OPENAI_API_KEY`

## Local Run
1. Start the DB API server.
This runs the Next.js `/api/db/[action]` bridge that the workflow calls for MongoDB reads and writes.

```bash
cd creon-store
bun install
bun run dev
```

2. Run the workflow with a sample listing fixture.
This sends a `createListing` input that inserts a product into the `products` collection.

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_allow.json"
```

## Fixture Test Matrix
Fixtures are sample store scenarios you can feed directly to the workflow.
Use this command pattern for any fixture:

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/<fixture>.json"
```

Suggested tour:
1. `create_listing_allow.json` creates a product listing.
2. `create_listing_allow_llm.json` forces LLM policy checks on that listing.
3. `list_basic.json` shows current listings (basic storefront feed).
4. `search_templates.json` filters listings by query and tags.
5. `purchase_success_x402.json` tests successful purchase via x402 proof.
6. `purchase_success_tx.json` tests successful purchase via direct tx proof.
7. `purchase_fee_mismatch.json` shows fee guardrails returning denial.
8. `purchase_duplicate_proof.json` and `purchase_already_owned.json` exercise duplicate detection.
9. `restore_owned.json` and `restore_not_owned.json` test ownership restore checks.
10. `refund_request.json` and `refund_eligible_review.json` test duplicate-only refund policy.
11. `governance_pause.json` and `governance_ban.json` test status updates.
12. `verify_tx.json` tests proof normalization output only.
13. `decide_allow.json` and `decide_deny.json` test generic decision routing.
