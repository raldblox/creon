"use client";

import { useMemo, useState } from "react";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ActionTab =
  | "createListing"
  | "list"
  | "search"
  | "purchase"
  | "settle"
  | "restore"
  | "refund"
  | "governance"
  | "verify"
  | "decide";

const LISTING_CATEGORY_VALUES = [
  "template",
  "download",
  "report",
  "api_credits",
  "license_key",
  "unlock",
] as const;

const DELIVERY_TYPE_VALUES = ["download", "api", "license", "content_unlock"] as const;
const DELIVERY_FORMAT_VALUES = ["pdf", "zip", "json", "key", "html", "other"] as const;
const DELIVERY_ACCESS_VALUES = ["direct", "gated"] as const;
const REFUND_POLICY_VALUES = ["no_refunds", "limited", "standard"] as const;
const GOVERNANCE_STATUS_VALUES = ["ACTIVE", "PAUSED", "DISCONTINUED", "BANNED"] as const;

type DbProduct = {
  productId: string;
  merchant: string;
  title?: string;
  pricing?: {
    currency?: string;
    chain?: string;
    amount?: string | number;
  };
};

type WalletInfo = {
  address: string;
  nativeBalance: string;
  usdcBalance?: string;
};

type PurchaseRunResult = {
  ok: boolean;
  product?: DbProduct;
  paymentRequired?: unknown;
  paymentSignature?: unknown;
  paymentResponse?: unknown;
  txn?: unknown;
  gatewayResponse?: unknown;
  workflowPayload?: unknown;
  error?: string;
};

type PurchaseStep = {
  at: string;
  stage: string;
  detail: string;
};

const ACTIONS: ActionTab[] = [
  "createListing",
  "list",
  "search",
  "purchase",
  "settle",
  "restore",
  "refund",
  "governance",
  "verify",
  "decide",
];

const DEFAULT_PRODUCT = {
  productId: "SKU_11111111_TEMPLATE_PREMIUMG_A00F3B7E",
  merchant: "0x1111111111111111111111111111111111111111",
  title: "Premium Growth Template Pack",
  description:
    "Production-ready templates for agentic commerce operations, metrics, and rollout checklists.",
  category: "template" as (typeof LISTING_CATEGORY_VALUES)[number],
  amount: "25",
  chain: "base-sepolia",
  currency: "USDC",
  tags: "template,commerce,ops",
};

const DEFAULTS = {
  buyer: "0x2222222222222222222222222222222222222222",
  actor: "0x9999999999999999999999999999999999999999",
  payTo: "0x001047dd630b4d985Dd0d13dFeac95C1536966F8",
  txHash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
  chainId: "84532",
  intentId: "intent-purchase-001",
};

const toJson = (value: unknown): string => JSON.stringify(value, null, 2);

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const READONLY_JSON_CLASS =
  "min-h-[120px] max-h-[260px] w-full resize-none overflow-auto whitespace-pre font-mono text-xs";
const SELECT_CLASS =
  "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

const asPrivateKey = (value: string): `0x${string}` => {
  const normalized = value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) return normalized as `0x${string}`;
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) return `0x${normalized}` as `0x${string}`;
  throw new Error("private key must be 64 hex bytes");
};

const parseAmount = (value: unknown): number => {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("invalid product amount");
  }
  return parsed;
};

const getFirstAccept = (required: unknown): { payTo?: string; network?: string; asset?: string } | null => {
  if (!required || typeof required !== "object") return null;
  const accepts = (required as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const first = accepts[0];
  if (!first || typeof first !== "object") return null;
  const typed = first as { payTo?: unknown; network?: unknown; asset?: unknown };
  return {
    payTo: typeof typed.payTo === "string" ? typed.payTo : undefined,
    network: typeof typed.network === "string" ? typed.network : undefined,
    asset: typeof typed.asset === "string" ? typed.asset : undefined,
  };
};

export function CreGatewayConsole() {
  const [action, setAction] = useState<ActionTab>("createListing");

  const [productId, setProductId] = useState(DEFAULT_PRODUCT.productId);
  const [merchant, setMerchant] = useState(DEFAULT_PRODUCT.merchant);
  const [title, setTitle] = useState(DEFAULT_PRODUCT.title);
  const [description, setDescription] = useState(DEFAULT_PRODUCT.description);
  const [category, setCategory] = useState(DEFAULT_PRODUCT.category);
  const [deliveryType, setDeliveryType] = useState<(typeof DELIVERY_TYPE_VALUES)[number]>("download");
  const [deliveryFormat, setDeliveryFormat] = useState<(typeof DELIVERY_FORMAT_VALUES)[number]>("zip");
  const [deliveryAccess, setDeliveryAccess] = useState<(typeof DELIVERY_ACCESS_VALUES)[number]>("gated");
  const [refundPolicy, setRefundPolicy] = useState<(typeof REFUND_POLICY_VALUES)[number]>("limited");
  const [amount, setAmount] = useState(DEFAULT_PRODUCT.amount);
  const [chain, setChain] = useState(DEFAULT_PRODUCT.chain);
  const [currency, setCurrency] = useState(DEFAULT_PRODUCT.currency);
  const [tags, setTags] = useState(DEFAULT_PRODUCT.tags);

  const [buyer, setBuyer] = useState(DEFAULTS.buyer);
  const [actor, setActor] = useState(DEFAULTS.actor);
  const [payTo, setPayTo] = useState(DEFAULTS.payTo);
  const [txHash, setTxHash] = useState(DEFAULTS.txHash);
  const [chainId, setChainId] = useState(DEFAULTS.chainId);
  const [intentId, setIntentId] = useState(DEFAULTS.intentId);

  const [limit, setLimit] = useState("20");
  const [query, setQuery] = useState("template");
  const [status, setStatus] = useState<(typeof GOVERNANCE_STATUS_VALUES)[number]>("PAUSED");
  const [allow, setAllow] = useState("true");

  const [agentWalletPrivateKey, setAgentWalletPrivateKey] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [walletError, setWalletError] = useState("");

  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<PurchaseRunResult | null>(null);
  const [purchaseSteps, setPurchaseSteps] = useState<PurchaseStep[]>([]);

  const payload = useMemo(() => {
    if (action === "purchase") {
      return purchaseResult?.workflowPayload ?? null;
    }

    switch (action) {
      case "createListing":
        return {
          input: {
            action,
            listing: {
              merchant,
              title,
              description,
              category,
              delivery: {
                type: deliveryType,
                format: deliveryFormat,
                access: deliveryAccess,
                restoreSupported: true,
              },
              pricing: { currency, chain, amount },
              tags: tags.split(",").map((v) => v.trim()).filter(Boolean),
              policies: { refundPolicy, maxPurchasesPerBuyer: 5 },
            },
          },
        };
      case "list":
        return { input: { action, limit: Number(limit) } };
      case "search":
        return {
          input: {
            action,
            query,
            tags: tags.split(",").map((v) => v.trim()).filter(Boolean),
            limit: Number(limit),
          },
        };
      case "settle":
        return {
          input: {
            action,
            intentId,
            settledBy: "ops-settlement-worker",
          },
        };
      case "restore":
        return { input: { action, buyer, productId } };
      case "refund":
        return { input: { action, intentId, buyer, productId, reason: "duplicate purchase" } };
      case "governance":
        return { input: { action, actor, productId, status } };
      case "verify":
        return {
          input: {
            action,
            proof: { tx: { chainId, txHash, payer: buyer, payTo, amount, token: currency } },
          },
        };
      case "decide":
        return {
          input: {
            action,
            allow: allow === "true",
            reasonCode: allow === "true" ? "ALLOW" : "DENY",
            context: { buyer, productId },
          },
        };
      default:
        return { input: { action } };
    }
  }, [
    action,
    actor,
    allow,
    amount,
    buyer,
    category,
    chain,
    chainId,
    currency,
    description,
    deliveryAccess,
    deliveryFormat,
    deliveryType,
    intentId,
    limit,
    merchant,
    payTo,
    productId,
    purchaseResult?.workflowPayload,
    query,
    status,
    tags,
    title,
    txHash,
    refundPolicy,
  ]);

  const payloadJson = useMemo(() => (payload ? toJson(payload) : ""), [payload]);

  const copyPayload = async () => {
    if (!payloadJson) return;
    await navigator.clipboard.writeText(payloadJson);
  };

  const loadWallet = async () => {
    setWalletLoading(true);
    setWalletError("");
    setWalletInfo(null);
    try {
      const privateKey = asPrivateKey(agentWalletPrivateKey);
      const account = privateKeyToAccount(privateKey);

      const rpcUrl =
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim() ||
        "https://base-sepolia-rpc.publicnode.com";
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(rpcUrl),
      });

      const native = await client.getBalance({ address: account.address });

      const usdcAddress = process.env.NEXT_PUBLIC_COMMERCE_USDC_ADDRESS?.trim();
      let usdcBalance: string | undefined;
      if (usdcAddress && /^0x[a-fA-F0-9]{40}$/.test(usdcAddress)) {
        const raw = (await client.readContract({
          address: usdcAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        })) as bigint;
        usdcBalance = formatUnits(raw, 6);
      }

      setWalletInfo({
        address: account.address,
        nativeBalance: formatEther(native),
        usdcBalance,
      });
      setBuyer(account.address);
    } catch (error) {
      setWalletError(String(error));
    } finally {
      setWalletLoading(false);
    }
  };

  const fetchProductFromDb = async (value: string): Promise<DbProduct> => {
    const response = await fetch("/api/db/find", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collection: "products",
        filter: { productId: value, status: "ACTIVE" },
        sort: { createdAt: -1 },
        limit: 1,
      }),
    });
    const body = (await response.json()) as { documents?: DbProduct[]; error?: string };
    if (!response.ok) {
      throw new Error(body.error || "db lookup failed");
    }
    const product = body.documents?.[0];
    if (!product) {
      throw new Error("product not found or not active");
    }
    return product;
  };

  const handlePurchase = async () => {
    setPurchaseLoading(true);
    setPurchaseResult((prev) =>
      prev
        ? { ...prev, ok: false, error: undefined }
        : { ok: false },
    );
    setPurchaseSteps([]);
    const pushStep = (stage: string, detail: string) => {
      setPurchaseSteps((prev) => [
        ...prev,
        { at: new Date().toISOString(), stage, detail },
      ]);
    };
    const patchResult = (patch: Partial<PurchaseRunResult>) => {
      setPurchaseResult((prev) => ({ ...(prev ?? { ok: false }), ...patch }));
    };
    try {
      pushStep("INIT", "Starting purchase flow");
      const privateKey = asPrivateKey(agentWalletPrivateKey);
      const account = privateKeyToAccount(privateKey);
      pushStep("WALLET", `Using buyer wallet ${account.address}`);
      const product = await fetchProductFromDb(productId);
      pushStep("DATABASE", `Loaded product ${product.productId} from /api/db/find`);
      patchResult({ product });
      const pricing = product.pricing ?? {};
      const baseAmount = parseAmount(pricing.amount);
      const feeBpsRaw = Number.parseInt(process.env.NEXT_PUBLIC_COMMERCE_FEE_BPS ?? "100", 10);
      const feeBps = Number.isFinite(feeBpsRaw) ? Math.max(0, Math.min(2500, feeBpsRaw)) : 100;
      const quotedPrice = round6(baseAmount).toString();
      pushStep("PRICING", `Using listed price ${quotedPrice} (feeBps ${feeBps} is taken from merchant payout)`);

      let capturedRequired: unknown = null;
      let capturedPaymentPayload: unknown = null;

      const coreClient = new x402Client()
        .register("eip155:*", new ExactEvmScheme(account))
        .onBeforePaymentCreation(async (context) => {
          capturedRequired = context.paymentRequired;
          pushStep("X402", "Received paymentRequired challenge");
          patchResult({ paymentRequired: context.paymentRequired });
        })
        .onAfterPaymentCreation(async (context) => {
          capturedPaymentPayload = context.paymentPayload;
          pushStep("X402", "Created payment signature payload");
          patchResult({ paymentSignature: context.paymentPayload });
        });
      const httpClient = new x402HTTPClient(coreClient);
      const paidFetch = wrapFetchWithPayment(fetch, httpClient);

      const purchaseUrl = `/api/cre/purchase?productId=${encodeURIComponent(
        product.productId,
      )}&price=${encodeURIComponent(quotedPrice)}`;
      const requestInit: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: product.productId,
          buyer: account.address,
        }),
      };

      pushStep("GATEWAY", "Calling purchase endpoint with x402 auto-payment");
      const paidResponse = await paidFetch(purchaseUrl, requestInit);
      const gatewayResponse = (await paidResponse.json().catch(() => ({}))) as Record<string, unknown>;
      patchResult({ gatewayResponse });

      let paymentResponse: unknown = null;
      try {
        paymentResponse = httpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
        pushStep("X402", "Decoded payment settle response");
      } catch {
        pushStep("X402", "No payment settle response header found");
      }
      patchResult({ paymentResponse });

      if (!paidResponse.ok) {
        pushStep("ERROR", `Paid request failed with status ${paidResponse.status}`);
        throw new Error(`paid request failed (${paidResponse.status}): ${toJson(gatewayResponse)}`);
      }
      pushStep("GATEWAY", `Paid request succeeded (${paidResponse.status})`);

      const workflowPayloadBase = gatewayResponse.workflowPayload as
        | Record<string, unknown>
        | undefined;
      const workflowInputBase =
        workflowPayloadBase && typeof workflowPayloadBase.input === "object"
          ? (workflowPayloadBase.input as Record<string, unknown>)
          : {};
      const paymentRequiredForPayload = capturedRequired;
      const paymentSignatureForPayload = capturedPaymentPayload;
      const serverPaidAmount = String(
        (gatewayResponse.purchase as { pricing?: { buyerPayAmount?: string; grossAmount?: string } } | undefined)
          ?.pricing?.buyerPayAmount ??
          (gatewayResponse.purchase as { pricing?: { buyerPayAmount?: string; grossAmount?: string } } | undefined)
            ?.pricing?.grossAmount ??
          quotedPrice,
      );
      const firstAccept = getFirstAccept(paymentRequiredForPayload);
      const payToFromRequirement = firstAccept?.payTo;
      const networkFromRequirement = firstAccept?.network;
      const assetFromRequirement = firstAccept?.asset;
      const settlementTxHash =
        typeof (paymentResponse as { transaction?: unknown } | null)?.transaction === "string"
          ? ((paymentResponse as { transaction: string }).transaction)
          : `0xpending-${Date.now().toString(16)}`;

      const workflowPayload = {
        input: {
          ...workflowInputBase,
          proof: {
            x402: {
              paymentRequired: paymentRequiredForPayload,
              paymentSignature: paymentSignatureForPayload,
              settlementTx: {
                txHash: settlementTxHash,
                chainId: String(baseSepolia.id),
                from: account.address,
                to:
                  payToFromRequirement ??
                  workflowInputBase.merchant,
                amount: serverPaidAmount,
                token:
                  (workflowInputBase.pricing as { currency?: string } | undefined)?.currency ?? "USDC",
              },
              network: networkFromRequirement ?? `eip155:${baseSepolia.id}`,
              asset:
                assetFromRequirement ??
                process.env.NEXT_PUBLIC_COMMERCE_USDC_ADDRESS ??
                "0x0000000000000000000000000000000000000000",
            },
          },
        },
      };
      pushStep("WORKFLOW", "Built workflow payload with x402 proof");
      patchResult({
        txn: {
          chainId: String(baseSepolia.id),
          txHash: settlementTxHash,
          buyer: account.address,
          paidAmount: quotedPrice,
          feeBps,
        },
        workflowPayload,
      });

      setPurchaseResult({
        ok: true,
        product,
        paymentRequired: paymentRequiredForPayload,
        paymentSignature: paymentSignatureForPayload,
        paymentResponse,
        txn: {
          chainId: String(baseSepolia.id),
          txHash: settlementTxHash,
          buyer: account.address,
          paidAmount: quotedPrice,
          feeBps,
        },
        gatewayResponse,
        workflowPayload,
      });
      pushStep("DONE", "Purchase flow completed");
    } catch (error) {
      const message = String(error);
      setPurchaseSteps((prev) => [
        ...prev,
        { at: new Date().toISOString(), stage: "ERROR", detail: message },
      ]);
      setPurchaseResult((prev) => ({
        ...(prev ?? { ok: false }),
        ok: false,
        error: message,
      }));
    } finally {
      setPurchaseLoading(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium tracking-wide text-blue-700">
            CRE Workflow Console
          </span>
          <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium tracking-wide text-slate-700">
            x402 Purchase Gateway
          </span>
          <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium tracking-wide text-slate-700">
            Live Payload Builder
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
          CREON HTTP Trigger Payload Generator
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Build, inspect, and copy action payloads for manual CRE simulation. Purchase mode also
          runs x402 flow and captures payment artifacts in real time.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2 rounded-xl border bg-card p-3">
        {ACTIONS.map((name) => (
          <Button
            key={name}
            type="button"
            onClick={() => setAction(name)}
            variant={action === name ? "default" : "outline"}
            size="sm"
            className="capitalize"
          >
            {name}
          </Button>
        ))}
      </div>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <Card className="min-w-0 border-slate-200/80 shadow-sm">
          <CardHeader>
            <CardTitle>Action Inputs</CardTitle>
            <CardDescription>Only fields relevant to `{action}` are shown.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            {action === "purchase" ? (
              <>
                <Label htmlFor="purchase-product-id">Product ID</Label>
                <Input
                  id="purchase-product-id"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                />

                <Label htmlFor="agent-wallet-key">Agent Wallet Private Key</Label>
                <Input
                  id="agent-wallet-key"
                  type="password"
                  value={agentWalletPrivateKey}
                  onChange={(e) => setAgentWalletPrivateKey(e.target.value)}
                  placeholder="0x..."
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">
                  Private key stays in-memory in this browser tab and is never written to storage.
                </p>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button className="w-full sm:w-auto" onClick={loadWallet} disabled={walletLoading}>
                    {walletLoading ? "Loading Wallet..." : "Load Wallet + Balance"}
                  </Button>
                  <Button
                    className="w-full sm:w-auto"
                    onClick={handlePurchase}
                    disabled={purchaseLoading || !walletInfo}
                  >
                    {purchaseLoading ? "Purchasing..." : "Purchase"}
                  </Button>
                </div>

                {walletError && <p className="text-sm text-red-600">{walletError}</p>}
                {walletInfo && (
                  <div className="min-w-0 rounded-lg border bg-slate-50 p-3 text-xs">
                    <p>
                      <strong>Address:</strong>{" "}
                      <span className="break-all">{walletInfo.address}</span>
                    </p>
                    <p>
                      <strong>Base Sepolia ETH:</strong> {walletInfo.nativeBalance}
                    </p>
                    <p>
                      <strong>USDC:</strong> {walletInfo.usdcBalance ?? "n/a (set NEXT_PUBLIC_COMMERCE_USDC_ADDRESS)"}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Live step logs</Label>
                  <Textarea
                    readOnly
                    value={purchaseSteps
                      .map((s) => `[${s.at}] [${s.stage}] ${s.detail}`)
                      .join("\n")}
                    className="min-h-[220px] max-h-[320px] w-full resize-none overflow-auto whitespace-pre rounded-lg border bg-slate-950 p-3 font-mono text-xs text-slate-100"
                  />
                </div>
              </>
            ) : (
              <>
                {(action === "restore" ||
                  action === "refund" ||
                  action === "governance" ||
                  action === "verify" ||
                  action === "decide") && (
                  <>
                    <Label htmlFor="productId">Product ID</Label>
                    <Input id="productId" value={productId} onChange={(e) => setProductId(e.target.value)} />
                  </>
                )}

                {action === "createListing" && (
                  <>
                    <Label htmlFor="merchant">Merchant</Label>
                    <Input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
                    <Label htmlFor="category">Category</Label>
                    <select
                      id="category"
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as (typeof LISTING_CATEGORY_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {LISTING_CATEGORY_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="deliveryType">Delivery Type</Label>
                    <select
                      id="deliveryType"
                      value={deliveryType}
                      onChange={(e) =>
                        setDeliveryType(e.target.value as (typeof DELIVERY_TYPE_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {DELIVERY_TYPE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="deliveryFormat">Delivery Format</Label>
                    <select
                      id="deliveryFormat"
                      value={deliveryFormat}
                      onChange={(e) =>
                        setDeliveryFormat(e.target.value as (typeof DELIVERY_FORMAT_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {DELIVERY_FORMAT_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="deliveryAccess">Delivery Access</Label>
                    <select
                      id="deliveryAccess"
                      value={deliveryAccess}
                      onChange={(e) =>
                        setDeliveryAccess(e.target.value as (typeof DELIVERY_ACCESS_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {DELIVERY_ACCESS_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="refundPolicy">Refund Policy</Label>
                    <select
                      id="refundPolicy"
                      value={refundPolicy}
                      onChange={(e) =>
                        setRefundPolicy(e.target.value as (typeof REFUND_POLICY_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {REFUND_POLICY_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="tags">Tags (comma separated)</Label>
                    <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                  </>
                )}

                {(action === "createListing" || action === "verify") && (
                  <>
                    <Label htmlFor="currency">Currency</Label>
                    <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
                    <Label htmlFor="chain">Chain</Label>
                    <Input id="chain" value={chain} onChange={(e) => setChain(e.target.value)} />
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </>
                )}

                {action === "list" && (
                  <>
                    <Label htmlFor="limit">Limit</Label>
                    <Input id="limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
                  </>
                )}

                {action === "search" && (
                  <>
                    <Label htmlFor="query">Query</Label>
                    <Input id="query" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <Label htmlFor="search-tags">Tags (comma separated)</Label>
                    <Input id="search-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                    <Label htmlFor="search-limit">Limit</Label>
                    <Input id="search-limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
                  </>
                )}

                {(action === "restore" || action === "refund" || action === "verify" || action === "decide") && (
                  <>
                    <Label htmlFor="buyer">Buyer</Label>
                    <Input id="buyer" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
                  </>
                )}

                {action === "verify" && (
                  <>
                    <Label htmlFor="chainId">Chain ID</Label>
                    <Input id="chainId" value={chainId} onChange={(e) => setChainId(e.target.value)} />
                    <Label htmlFor="txHash">Tx Hash</Label>
                    <Input id="txHash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                    <Label htmlFor="payTo">Pay To</Label>
                    <Input id="payTo" value={payTo} onChange={(e) => setPayTo(e.target.value)} />
                  </>
                )}

                {(action === "refund" || action === "settle") && (
                  <>
                    <Label htmlFor="intentId">Intent ID</Label>
                    <Input id="intentId" value={intentId} onChange={(e) => setIntentId(e.target.value)} />
                  </>
                )}

                {action === "governance" && (
                  <>
                    <Label htmlFor="actor">Actor</Label>
                    <Input id="actor" value={actor} onChange={(e) => setActor(e.target.value)} />
                    <Label htmlFor="status">Status</Label>
                    <select
                      id="status"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as (typeof GOVERNANCE_STATUS_VALUES)[number])
                      }
                      className={SELECT_CLASS}
                    >
                      {GOVERNANCE_STATUS_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {action === "decide" && (
                  <>
                    <Label htmlFor="allow">Allow (`true` or `false`)</Label>
                    <Input id="allow" value={allow} onChange={(e) => setAllow(e.target.value)} />
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {action === "purchase" ? (
            <>
              <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                  <CardTitle>x402 Purchase Artifacts</CardTitle>
                  <CardDescription>
                    Shows 402 challenge + signed payment + facilitator settlement response.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-4">
                  {purchaseResult?.error && <p className="text-sm text-red-600">{purchaseResult.error}</p>}

                  <Label>Product from DB</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.product ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                  <Label>paymentRequired</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.paymentRequired ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                  <Label>paymentSignature</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.paymentSignature ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                  <Label>paymentResponse</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.paymentResponse ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                  <Label>txn</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.txn ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                  <Label>Gateway response</Label>
                  <Textarea
                    readOnly
                    value={toJson(purchaseResult?.gatewayResponse ?? {})}
                    className={READONLY_JSON_CLASS}
                  />

                </CardContent>
              </Card>

              <Card className="border-slate-200/80 shadow-sm">
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>Workflow Payload Ready</CardTitle>
                    <CardDescription>
                      Full JSON to manually feed CRE workflow HTTP trigger.
                    </CardDescription>
                  </div>
                  <Button onClick={copyPayload} disabled={!payloadJson}>
                    Copy JSON
                  </Button>
                </CardHeader>
                <CardContent>
                  <Textarea
                    readOnly
                    value={payloadJson}
                    className="min-h-[260px] max-h-[360px] resize-none overflow-auto whitespace-pre rounded-lg border bg-slate-950 p-3 font-mono text-xs text-slate-100"
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>HTTP Trigger Payload JSON</CardTitle>
                  <CardDescription>
                    Exact shape to paste into `cre workflow simulate` prompt.
                  </CardDescription>
                </div>
                <Button onClick={copyPayload} disabled={!payloadJson}>
                  Copy JSON
                </Button>
              </CardHeader>
              <CardContent>
                <Textarea
                  readOnly
                  value={payloadJson}
                  className="min-h-[560px] max-h-[70vh] resize-none overflow-auto whitespace-pre rounded-lg border bg-slate-950 p-3 font-mono text-xs text-slate-100"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}


