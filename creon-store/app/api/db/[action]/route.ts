import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ServerApiVersion, type Document } from "mongodb";
import dns from "node:dns";
import { resolveMongoUri } from "@/lib/mongodb-uri";

let cachedClient: MongoClient | null = null;
let cachedResolvedUri: string | null = null;
let dnsConfigured = false;

const ISO_UTC_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TEMPORAL_FIELD_REGEX = /(At|Date)$/i;

const configureDnsResolvers = () => {
  if (dnsConfigured) {
    return;
  }
  const configured = process.env.MONGODB_DNS_SERVERS ?? "1.1.1.1,8.8.8.8";
  const servers = configured
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (servers.length > 0) {
    dns.setServers(servers);
  }
  dnsConfigured = true;
};

const getClient = async (): Promise<MongoClient> => {
  if (cachedClient) {
    return cachedClient;
  }

  configureDnsResolvers();

  const rawUri = process.env.MONGODB_ATLAS_URI;
  if (!rawUri) {
    throw new Error("MONGODB_ATLAS_URI is required");
  }
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

const toPlainJson = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object" && "_bsontype" in (val as object)) {
        return String(val);
      }
      return val;
    }),
  );

const normalizeTemporalValues = (value: unknown, parentKey?: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTemporalValues(item));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      normalizeTemporalValues(child, key),
    ]);
    return Object.fromEntries(entries);
  }

  if (
    typeof value === "string" &&
    parentKey &&
    TEMPORAL_FIELD_REGEX.test(parentKey) &&
    ISO_UTC_REGEX.test(value)
  ) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return value;
};

const requireApiKeyIfConfigured = (request: NextRequest): NextResponse | null => {
  const configured = process.env.MONGODB_DB_API_KEY ?? "";
  if (!configured) {
    return null;
  }

  const incoming = request.headers.get("x-db-api-key") ?? "";
  if (incoming !== configured) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
};

const asSortDocument = (input: Record<string, unknown> | undefined): Document => {
  if (!input) {
    return {};
  }
  return input as Document;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const unauthorized = requireApiKeyIfConfigured(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { action } = await context.params;
  const payload = (await request.json()) as {
    database?: string;
    collection?: string;
    document?: Record<string, unknown>;
    filter?: Record<string, unknown>;
    projection?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    limit?: number;
    update?: Record<string, unknown>;
    upsert?: boolean;
    buyer?: string;
    merchant?: string;
    productId?: string;
    intentId?: string;
    fingerprint?: string;
    proofKind?: string;
    paymentTxHash?: string;
    entitlementTxHash?: string;
    agentWallet?: string;
    grossAmount?: number;
    feeAmount?: number;
    merchantNetAmount?: number;
    feeBps?: number;
    nowIso?: string;
  };

  const database = payload.database || process.env.MONGODB_DATABASE || "creon_store";
  const collectionName = payload.collection;
  if (action !== "purchaseCommit" && !collectionName) {
    return NextResponse.json({ error: "collection is required" }, { status: 400 });
  }

  try {
    const client = await getClient();
    const db = client.db(database);
    const collection = collectionName ? db.collection(collectionName) : null;

    if (action === "insertOne") {
      if (!collection) {
        return NextResponse.json({ error: "collection is required" }, { status: 400 });
      }
      const normalizedDocument = normalizeTemporalValues(payload.document ?? {}) as Document;
      const result = await collection.insertOne(normalizedDocument);
      return NextResponse.json({ insertedId: String(result.insertedId) });
    }

    if (action === "find") {
      if (!collection) {
        return NextResponse.json({ error: "collection is required" }, { status: 400 });
      }
      const docs = await collection
        .find(payload.filter ?? {}, {
          projection: payload.projection,
        })
        .sort(asSortDocument(payload.sort))
        .limit(payload.limit ?? 20)
        .toArray();
      return NextResponse.json({ documents: toPlainJson(docs) });
    }

    if (action === "updateOne") {
      if (!collection) {
        return NextResponse.json({ error: "collection is required" }, { status: 400 });
      }
      const normalizedUpdate = normalizeTemporalValues(payload.update ?? {}) as Document;
      const result = await collection.updateOne(payload.filter ?? {}, normalizedUpdate, {
        upsert: payload.upsert ?? false,
      });
      return NextResponse.json({
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
      });
    }

    if (action === "repairTimestamps") {
      const collections = Array.isArray(payload.collection)
        ? payload.collection
        : [
            "products",
            "purchases",
            "entitlements",
            "replay_store",
            "merchant_settlements",
            "settlement_queue",
          ];
      const fields = ["createdAt", "updatedAt", "grantedAt", "settledAt"];
      const results: Record<string, number> = {};

      for (const name of collections) {
        if (typeof name !== "string" || name.length === 0) continue;
        const setStage = Object.fromEntries(
          fields.map((field) => [
            field,
            {
              $cond: [
                { $eq: [{ $type: `$${field}` }, "string"] },
                {
                  $dateFromString: {
                    dateString: `$${field}`,
                    onError: `$${field}`,
                    onNull: `$${field}`,
                  },
                },
                `$${field}`,
              ],
            },
          ]),
        );

        const res = await db
          .collection(name)
          .updateMany({}, [{ $set: setStage }] as Document[]);
        results[name] = res.modifiedCount;
      }

      return NextResponse.json({ ok: true, repaired: results });
    }

    if (action === "purchaseCommit") {
      const nowIso = payload.nowIso || new Date().toISOString();
      const nowDate = new Date(nowIso);
      const nowValue = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
      const buyer = String(payload.buyer ?? "");
      const merchant = String(payload.merchant ?? "");
      const productId = String(payload.productId ?? "");
      const intentId = String(payload.intentId ?? "");
      const fingerprint = String(payload.fingerprint ?? "");
      const proofKind = String(payload.proofKind ?? "");
      const paymentTxHash = String(payload.paymentTxHash ?? "");
      const entitlementTxHash = String(payload.entitlementTxHash ?? "");
      const agentWallet = String(payload.agentWallet ?? "");
      const grossAmount = Number(payload.grossAmount ?? 0);
      const feeAmount = Number(payload.feeAmount ?? 0);
      const merchantNetAmount = Number(payload.merchantNetAmount ?? 0);
      const feeBps = Number(payload.feeBps ?? 0);

      if (
        !buyer ||
        !merchant ||
        !productId ||
        !intentId ||
        !fingerprint ||
        !paymentTxHash ||
        !entitlementTxHash
      ) {
        return NextResponse.json(
          { error: "purchaseCommit missing required fields" },
          { status: 400 },
        );
      }

      await db.collection("replay_store").updateOne(
        { fingerprint },
        {
          $setOnInsert: {
            fingerprint,
            intentId,
            buyer,
            merchant,
            productId,
            proofKind,
            createdAt: nowValue,
          },
        },
        { upsert: true },
      );

      await db.collection("entitlements").updateOne(
        { buyer, productId },
        {
          $setOnInsert: {
            buyer,
            merchant,
            productId,
            intentId,
            txHash: entitlementTxHash,
            grantedAt: nowValue,
          },
        },
        { upsert: true },
      );

      await db.collection("purchases").insertOne({
        intentId,
        buyer,
        merchant,
        productId,
        fingerprint,
        proofKind,
        baseAmount: grossAmount,
        grossAmount,
        feeAmount,
        merchantNetAmount,
        feeBps,
        paymentTxHash,
        entitlementTxHash,
        createdAt: nowValue,
      });

      await db.collection("merchant_settlements").updateOne(
        { merchant },
        {
          $inc: {
            purchaseCount: 1,
            grossCollected: grossAmount,
            feeCollected: feeAmount,
            netOwedToMerchant: merchantNetAmount,
          },
          $set: {
            merchant,
            settlementWallet: agentWallet,
            updatedAt: nowValue,
          },
          $setOnInsert: {
            createdAt: nowValue,
          },
        },
        { upsert: true },
      );

      await db.collection("settlement_queue").insertOne({
        intentId,
        buyer,
        merchant,
        productId,
        proofKind,
        paymentTxHash,
        entitlementTxHash,
        grossAmount,
        feeAmount,
        merchantNetAmount,
        feeBps,
        settlementWallet: agentWallet,
        status: "PENDING",
        settlementMode:
          proofKind === "x402" ? "x402_transfer_only_two_step" : "standard_two_step",
        createdAt: nowValue,
        updatedAt: nowValue,
      });

      return NextResponse.json({ ok: true, committed: true });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = String(error);
    if (message.includes("querySrv")) {
      cachedResolvedUri = null;
      return NextResponse.json(
        {
          error:
            "db api failure: SRV DNS lookup failed even after DoH fallback. Check network/VPN DNS filtering and retry.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `db api failure: ${message}` },
      { status: 500 },
    );
  }
}
