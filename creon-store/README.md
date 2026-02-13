## CREON Store Gateway

Next.js 16 gateway for CREON workflow with x402-gated purchase.

## Public API
- `POST /api/cre/createListing`
- `POST /api/cre/list`
- `POST /api/cre/search`
- `POST /api/cre/purchase` (x402 gated via `proxy.ts`)
- `POST /api/cre/settle`
- `POST /api/cre/restore`
- `POST /api/cre/refund`
- `POST /api/cre/governance`
- `POST /api/cre/verify`
- `POST /api/cre/decide`

## x402 Flow (Purchase)
1. Frontend fetches product from `/api/db/find` using `productId`.
2. Frontend computes gross (`base + fee`) and calls:
   - `POST /api/cre/purchase?productId=<id>&price=<gross>`
3. `proxy.ts` enforces x402 on that route, using:
   - `HTTPFacilitatorClient`
   - `x402ResourceServer`
   - lifecycle hooks (`onBeforeVerify`, `onAfterVerify`, `onBeforeSettle`, `onAfterSettle`, etc.)
4. Buyer side retries with payment using `@x402/fetch`.
5. Frontend receives:
   - `paymentRequired`
   - `paymentSignature`
   - `PAYMENT-RESPONSE` (decoded)
   - gateway response
   - workflow payload ready for CRE trigger.

## Required Env
- `MONGODB_ATLAS_URI`
- `MONGODB_DATABASE` (default `creon_store`)
- `MONGODB_DNS_SERVERS` (default `1.1.1.1,8.8.8.8`)
- `CRE_WORKFLOW_URL` (optional; if set, purchase route forwards workflow payload)
- `CRE_WORKFLOW_API_KEY` (optional)
- `X402_FACILITATOR_URL` (default `https://x402.org/facilitator`)
- `AGENT_WALLET_ADDRESS` (x402 `payTo`)
- `COMMERCE_USDC_ADDRESS` (x402 asset)
- `COMMERCE_TOKEN_DECIMALS` (default `6`)
- `COMMERCE_FEE_BPS` (default `100`, max `2500`)

Frontend wallet/balance helper expects:
- `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_COMMERCE_USDC_ADDRESS`
- `NEXT_PUBLIC_COMMERCE_FEE_BPS`

## DB Bridge
- `POST /api/db/insertOne`
- `POST /api/db/find`
- `POST /api/db/updateOne`
