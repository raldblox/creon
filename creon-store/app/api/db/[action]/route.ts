import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ServerApiVersion, type Document } from "mongodb";
import dns from "node:dns";

let cachedClient: MongoClient | null = null;
let dnsConfigured = false;

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

  const uri = process.env.MONGODB_ATLAS_URI;
  if (!uri) {
    throw new Error("MONGODB_ATLAS_URI is required");
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  cachedClient = client;
  return client;
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
  };

  const database = payload.database || process.env.MONGODB_DATABASE || "creon_store";
  const collectionName = payload.collection;
  if (!collectionName) {
    return NextResponse.json({ error: "collection is required" }, { status: 400 });
  }

  try {
    const client = await getClient();
    const collection = client.db(database).collection(collectionName);

    if (action === "insertOne") {
      const result = await collection.insertOne((payload.document ?? {}) as Document);
      return NextResponse.json({ insertedId: String(result.insertedId) });
    }

    if (action === "find") {
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
      const result = await collection.updateOne(payload.filter ?? {}, payload.update ?? {}, {
        upsert: payload.upsert ?? false,
      });
      return NextResponse.json({
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
      });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = String(error);
    if (message.includes("querySrv ECONNREFUSED")) {
      return NextResponse.json(
        {
          error:
            "db api failure: SRV DNS lookup failed. Set MONGODB_DNS_SERVERS (e.g. 1.1.1.1,8.8.8.8) or use a network/VPN with working SRV DNS.",
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
