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

## Action Behavior
- `createListing`: validates listing payload, optionally runs deterministic + LLM policy checks, then stores product document in `products`.
- `list`: reads from `products`, excluding banned listings unless `includeInactive=true`.
- `search`: performs regex-based title/description search plus tag filtering on `products`.
- `purchase`: validates chain/currency defaults, validates proof + fee, rejects duplicates, records purchase, updates entitlement, and writes onchain entitlement.
- `restore`: checks product existence/status and buyer entitlement before allowing restore.
- `refund`: checks duplicate-purchase eligibility (`refund_eligibility`) and onchain entitlement before allowing refund.
- `governance`: updates product status and governance actor metadata.
- `verify`: normalizes and returns payment proof metadata.
- `decide`: returns an allow/deny decision object for orchestration/testing.

## OpenAI LLM Policy Classifier
The LLM path is implemented in `workflow/integration/openai.ts` and is called by
`workflow/process/createListing.ts` only when `ENABLE_POLICY_CHECKS=true`.

Classification output:
- `complianceFlags`
- `riskTier` (`low`, `medium`, `high`)
- `recommendedPolicy` (`allow`, `review`, `deny`)
- `confidence` (0..1)

Behavior:
- If deterministic checks fail, listing is denied before LLM.
- If LLM returns `deny`, listing is denied with `reasonCode=POLICY_DENY_LLM`.
- If allowed/review, listing is stored and `llmPolicy` is saved in MongoDB.

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
1. Start Next.js DB API first.
This serves `/api/db/[action]`, which is the workflow's database bridge.

```bash
cd ./creon-store
bun install
bun run dev
```

2. Run the workflow with the list fixture.
This executes the `list` action and returns current products from MongoDB.

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/list_basic.json"
```

If your fixture folder is `creon-workflow/fixtures`, use:

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/creon-workflow/fixtures/list_basic.json"
```

Expected log checkpoints include:
- `CHECK: input validated`
- `CHECK: action resolved = list`
- `CHECK: mongodb read ok`

To test LLM classification on listing:
1. Set `ENABLE_POLICY_CHECKS=true` and valid OpenAI keys in root `.env`.
2. Run:

```bash
cre workflow simulate ./workflow --env .env --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_allow.json"
```

Expected LLM logs:
- `CHECK: openai classification start`
- `CHECK: openai classification completed status=200`
- `CHECK: llm classification completed`

## Fixture Coverage
Fixtures are practical samples for storefront and payment flows.
Each file under `workflow/fixtures/` is a ready-to-run payload.

- `create_listing_allow.json`: happy-path listing create.
- `create_listing_deny_deterministic.json`: deterministic policy deny case.
- `list_basic.json`: fetch basic listing feed.
- `search_templates.json`: search by terms/tags.
- `purchase_success_x402.json`: successful purchase with x402 proof.
- `purchase_success_tx.json`: successful purchase with tx proof.
- `purchase_fee_mismatch.json`: amount/fee mismatch rejection.
- `purchase_duplicate_proof.json`: duplicate proof replay path.
- `purchase_already_owned.json`: duplicate entitlement path.
- `restore_owned.json`: restore allowed for owner.
- `restore_not_owned.json`: restore denied for non-owner.
- `restore_banned.json`: restore denied for banned product.
- `restore_product_not_found.json`: restore denied for missing product.
- `refund_request.json`: refund request evaluation input.
- `refund_eligible_review.json`: refund-eligible duplicate review path.
- `governance_pause.json`: mark listing as paused.
- `governance_ban.json`: mark listing as banned.
- `verify_tx.json`: proof normalization route.
- `decide_allow.json`: generic allow decision.
- `decide_deny.json`: generic deny decision.
- `INDEX.json`: fixture index reference.
