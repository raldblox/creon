# CREON Workflow

This workflow is organized around a single HTTP trigger entrypoint that routes by
`input.action` into [`workflow/process/`](workflow/process/).

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
- `createListing`: validates listing payload, generates authoritative `productId` as `SKU_...`, optionally runs deterministic + LLM policy checks, then stores product document in `products`.
- `list`: reads from `products`, excluding banned listings unless `includeInactive=true`.
- `search`: performs regex-based title/description search plus tag filtering on `products`.
- `purchase`: validates chain/currency defaults, validates proof + fee, rejects duplicates, records purchase, updates entitlement, and writes onchain entitlement.
- `restore`: checks product existence/status and buyer entitlement before allowing restore.
- `refund`: checks duplicate-purchase eligibility (`refund_eligibility`) and onchain entitlement before allowing refund.
- `governance`: updates product status and governance actor metadata.
- `verify`: normalizes and returns payment proof metadata.
- `decide`: returns an allow/deny decision object for orchestration/testing.

## OpenAI LLM Policy Classifier
The LLM path is implemented in [`workflow/integration/openai.ts`](workflow/integration/openai.ts) and is called by
[`workflow/process/createListing.ts`](workflow/process/createListing.ts) only when `ENABLE_POLICY_CHECKS=true`.
The system prompt is isolated in [`workflow/lib/prompts/listingPolicy.ts`](workflow/lib/prompts/listingPolicy.ts).
Reference pattern: https://smartcontractkit.github.io/cre-bootcamp-2026/day-2/04-ai-integration.html

Classification output:
- `complianceFlags`
- `complianceDomains` (`financial_crime`, `sanctions_trade`, `ip_abuse`, `malware_cybercrime`, `deceptive_marketing`, `consumer_protection`)
- `evidence` (short evidence strings from listing content)
- `riskTier` (`low`, `medium`, `high`)
- `recommendedPolicy` (`allow`, `review`, `deny`)
- `confidence` (0..1)

Behavior:
- Deterministic checks are evaluated for signals/flags, but OpenAI remains the final allow/deny decision maker.
- If LLM returns `deny`, listing is denied with `reasonCode=POLICY_DENY_LLM`.
- If allowed/review, listing is stored and `llmPolicy` is saved in MongoDB.
- `OPENAI_API_KEY` can be loaded from `.env` or workflow secret `OPENAI_API_KEY`.

## Risk And Compliance Commitment
For digital goods/services commerce, this workflow is designed to produce auditable policy outcomes:
- Deterministic checks provide stable rule-based signals.
- LLM classification adds contextual risk/compliance reasoning and evidence.
- Compliance domains are explicitly labeled to support monitoring, governance review, and incident response.

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
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/list_basic.json"
```

Deterministic SKU example for [`create_listing_template_pack.json`](workflow/fixtures/create_listing_template_pack.json):
- `SKU_11111111_TEMPLATE_PREMIUMG_A00F3B7E`

If your fixture folder is `creon-workflow/fixtures`, use:

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/creon-workflow/fixtures/list_basic.json"
```

Expected log checkpoints include:
- `[INPUT] validated payload`
- `[ACTION] routing action=list`
- `[MONGODB] list query completed`

To test LLM classification on listing:
1. Set `ENABLE_POLICY_CHECKS=true` and valid OpenAI keys in root `.env`.
2. Run:

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_template_pack_llm.json"
```

Note: `--env .env` is optional if your shell/default environment is already configured.

Expected LLM logs:
- `[OPENAI] analyzing listing policy`
- `[OPENAI] analysis completed status=200`
- `[OPENAI] listing policy classification completed`

## Exact Allow And Deny Runs
Allow listing (template pack for commerce operations):

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_template_pack.json"
```

Deny listing via illicit keywords (contains terms like "stolen" and "exploit kit"):

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_underground_access_kit.json"
```

Deny listing via scam pattern (scam phrases + very high price):

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_profit_multiplier_vault.json"
```

More policy-decision challenges:

```bash
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_brand_clone_starter.json"
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_malware_loader_bundle.json"
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_enterprise_playbook.json"
cre workflow simulate ./workflow --target=staging-settings --non-interactive --trigger-index=0 --http-payload "@$(pwd)/workflow/fixtures/create_listing_roi_signals_membership.json"
```

## Fixture Coverage
Fixtures are practical samples for storefront and payment flows.
Each file under [`workflow/fixtures/`](workflow/fixtures/) is a ready-to-run payload.

- [`create_listing_template_pack.json`](workflow/fixtures/create_listing_template_pack.json): template bundle listing.
- [`create_listing_template_pack_llm.json`](workflow/fixtures/create_listing_template_pack_llm.json): same template listing for explicit LLM-path run.
- [`create_listing_underground_access_kit.json`](workflow/fixtures/create_listing_underground_access_kit.json): illicit underground-kit scenario.
- [`create_listing_profit_multiplier_vault.json`](workflow/fixtures/create_listing_profit_multiplier_vault.json): scam-claims and high-price scenario.
- [`create_listing_brand_clone_starter.json`](workflow/fixtures/create_listing_brand_clone_starter.json): brand impersonation scenario.
- [`create_listing_malware_loader_bundle.json`](workflow/fixtures/create_listing_malware_loader_bundle.json): malware-style payload scenario.
- [`create_listing_enterprise_playbook.json`](workflow/fixtures/create_listing_enterprise_playbook.json): low-risk enterprise playbook scenario.
- [`create_listing_roi_signals_membership.json`](workflow/fixtures/create_listing_roi_signals_membership.json): aggressive ROI-marketing scenario.
- [`list_basic.json`](workflow/fixtures/list_basic.json): fetch basic listing feed.
- [`search_templates.json`](workflow/fixtures/search_templates.json): search by terms/tags.
- [`purchase_success_x402.json`](workflow/fixtures/purchase_success_x402.json): successful purchase with x402 proof.
- [`purchase_success_tx.json`](workflow/fixtures/purchase_success_tx.json): successful purchase with tx proof.
- [`purchase_fee_mismatch.json`](workflow/fixtures/purchase_fee_mismatch.json): amount/fee mismatch rejection.
- [`purchase_duplicate_proof.json`](workflow/fixtures/purchase_duplicate_proof.json): duplicate proof replay path.
- [`purchase_already_owned.json`](workflow/fixtures/purchase_already_owned.json): duplicate entitlement path.
- [`restore_owned.json`](workflow/fixtures/restore_owned.json): restore allowed for owner.
- [`restore_not_owned.json`](workflow/fixtures/restore_not_owned.json): restore denied for non-owner.
- [`restore_banned.json`](workflow/fixtures/restore_banned.json): restore denied for banned product.
- [`restore_product_not_found.json`](workflow/fixtures/restore_product_not_found.json): restore denied for missing product.
- [`refund_request.json`](workflow/fixtures/refund_request.json): refund request evaluation input.
- [`refund_eligible_review.json`](workflow/fixtures/refund_eligible_review.json): refund-eligible duplicate review path.
- [`governance_pause.json`](workflow/fixtures/governance_pause.json): mark listing as paused.
- [`governance_ban.json`](workflow/fixtures/governance_ban.json): mark listing as banned.
- [`verify_tx.json`](workflow/fixtures/verify_tx.json): proof normalization route.
- [`decide_allow.json`](workflow/fixtures/decide_allow.json): generic allow decision.
- [`decide_deny.json`](workflow/fixtures/decide_deny.json): generic deny decision.
- [`INDEX.json`](workflow/fixtures/INDEX.json): fixture index reference.
