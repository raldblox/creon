## CREON Store Gateway

This Next.js 16 app is the public gateway for CREON workflow access.

## Public Endpoints
- `POST /api/cre/createListing`
- `POST /api/cre/list`
- `POST /api/cre/search`
- `POST /api/cre/purchase` (x402-gated)
- `POST /api/cre/settle`
- `POST /api/cre/restore`
- `POST /api/cre/refund`
- `POST /api/cre/governance`
- `POST /api/cre/verify`
- `POST /api/cre/decide`

Behavior:
- Gateway forwards each request to `CRE_WORKFLOW_URL`.
- Gateway injects `input.action` from `[action]` route param.
- `proxy.ts` enforces x402 payment header for `POST /api/cre/purchase`.
- Optional strict verification can be enabled with `X402_VERIFY_URL`.

## Required Env
- `CRE_WORKFLOW_URL` (public/private CRE workflow endpoint)
- `CRE_WORKFLOW_API_KEY` (optional bearer token for workflow endpoint)
- `X402_VERIFY_URL` (optional verifier endpoint; if set, purchase requests must validate)

## Existing DB Bridge
- `POST /api/db/insertOne`
- `POST /api/db/find`
- `POST /api/db/updateOne`

These routes are used by workflow-side Mongo integration.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
