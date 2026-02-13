import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ServerApiVersion, type Document } from "mongodb";
import dns from "node:dns";
import { resolveMongoUri } from "@/lib/mongodb-uri";

let cachedClient: MongoClient | null = null;
let cachedResolvedUri: string | null = null;
let dnsConfigured = false;

const configureDnsResolvers = () => {
  if (dnsConfigured) return;
  const configured = process.env.MONGODB_DNS_SERVERS ?? "1.1.1.1,8.8.8.8";
  const servers = configured
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (servers.length > 0) dns.setServers(servers);
  dnsConfigured = true;
};

const getMongoClient = async (): Promise<MongoClient> => {
  if (cachedClient) return cachedClient;
  configureDnsResolvers();
  const rawUri = process.env.MONGODB_ATLAS_URI;
  if (!rawUri) throw new Error("MONGODB_ATLAS_URI is required");

  const buildClient = (uri: string) =>
    new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

  const firstUri =
    cachedResolvedUri ??
    (rawUri.startsWith("mongodb+srv://")
      ? await resolveMongoUri(rawUri).catch(() => rawUri)
      : rawUri);

  try {
    const firstClient = buildClient(firstUri);
    await firstClient.connect();
    cachedResolvedUri = firstUri;
    cachedClient = firstClient;
    return firstClient;
  } catch (firstError) {
    const message = String(firstError);
    if (!rawUri.startsWith("mongodb+srv://") || !message.includes("querySrv")) {
      throw firstError;
    }
    const fallbackUri = await resolveMongoUri(rawUri);
    const fallbackClient = buildClient(fallbackUri);
    await fallbackClient.connect();
    cachedResolvedUri = fallbackUri;
    cachedClient = fallbackClient;
    return fallbackClient;
  }
};

const parsePositiveAmount = (value: unknown): number => {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("invalid product amount");
  }
  return parsed;
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const forwardWorkflowIfConfigured = async (payload: unknown): Promise<unknown | null> => {
  const workflowUrl = process.env.CRE_WORKFLOW_URL?.trim() ?? "";
  if (!workflowUrl) return null;

  const workflowKey = process.env.CRE_WORKFLOW_API_KEY?.trim() ?? "";
  const response = await fetch(workflowUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workflowKey ? { authorization: `Bearer ${workflowKey}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  return {
    status: response.status,
    ok: response.ok,
    body: parsed,
  };
};

type PurchaseBody = {
  productId?: string;
  buyer?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as PurchaseBody;
    const queryProductId = request.nextUrl.searchParams.get("productId")?.trim() ?? "";
    const productId = (body.productId ?? queryProductId).trim();

    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    const database = process.env.MONGODB_DATABASE || "creon_store";
    const client = await getMongoClient();
    const product = (await client
      .db(database)
      .collection("products")
      .findOne({ productId, status: "ACTIVE" })) as Document | null;

    if (!product) {
      return NextResponse.json(
        { error: "active product not found", productId },
        { status: 404 },
      );
    }

    const pricing = (product.pricing ?? {}) as Record<string, unknown>;
    const baseAmount = parsePositiveAmount(pricing.amount);
    const feeBpsRaw = Number.parseInt(process.env.COMMERCE_FEE_BPS ?? "100", 10);
    const feeBps = Number.isFinite(feeBpsRaw) ? Math.max(0, Math.min(2500, feeBpsRaw)) : 100;
    const listedAmount = round6(baseAmount);
    const feeAmount = round6((baseAmount * feeBps) / 10_000);
    const buyerPayAmount = listedAmount;
    const merchantNetAmount = round6(listedAmount - feeAmount);
    const buyer = (body.buyer ?? "").trim();
    const merchant = String(product.merchant ?? "");
    const currency = String(pricing.currency ?? "USDC");
    const chain = String(pricing.chain ?? "base-sepolia");

    const workflowPayload = {
      input: {
        action: "purchase",
        intentId: `intent-${productId.toLowerCase()}-${Date.now()}`,
        buyer,
        merchant,
        productId,
        pricing: {
          currency,
          chain,
          amount: listedAmount.toString(),
        },
        feeBps,
      },
    };

    const workflowForward = await forwardWorkflowIfConfigured(workflowPayload);
    return NextResponse.json({
      ok: true,
      purchase: {
        productId,
        buyer,
        merchant,
        pricing: {
          currency,
          chain,
          amount: listedAmount.toString(),
          feeBps,
          feeAmount: feeAmount.toString(),
          buyerPayAmount: buyerPayAmount.toString(),
          merchantNetAmount: merchantNetAmount.toString(),
        },
      },
      workflowPayload,
      workflowForward,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `purchase route failed: ${String(error)}` },
      { status: 500 },
    );
  }
}
