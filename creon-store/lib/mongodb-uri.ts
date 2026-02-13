type DnsAnswer = {
  data?: string;
};

type DnsResponse = {
  Answer?: DnsAnswer[];
};

const parseSrvRecords = (answers: DnsAnswer[] | undefined): string[] => {
  if (!answers || answers.length === 0) return [];
  return answers
    .map((answer) => answer.data ?? "")
    .map((data) => data.trim())
    .filter(Boolean)
    .map((data) => {
      const parts = data.split(/\s+/);
      if (parts.length < 4) return "";
      const port = parts[2];
      const host = parts[3].replace(/\.$/, "");
      return `${host}:${port}`;
    })
    .filter(Boolean);
};

const parseTxtRecords = (answers: DnsAnswer[] | undefined): URLSearchParams => {
  const params = new URLSearchParams();
  if (!answers || answers.length === 0) return params;

  for (const answer of answers) {
    const raw = answer.data ?? "";
    const normalized = raw.replace(/^"+|"+$/g, "").replace(/"\s*"/g, "");
    const segments = normalized.split("&").map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const [k, v = ""] = segment.split("=");
      if (k) params.set(k, v);
    }
  }

  return params;
};

const fetchDnsJson = async (name: string, type: "SRV" | "TXT"): Promise<DnsResponse> => {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`DoH request failed (${response.status})`);
  }
  return (await response.json()) as DnsResponse;
};

const getAuthPart = (uri: string): string => {
  const marker = "mongodb+srv://";
  const start = uri.indexOf(marker);
  if (start < 0) return "";
  const after = uri.slice(start + marker.length);
  const at = after.indexOf("@");
  if (at < 0) return "";
  return after.slice(0, at);
};

export const resolveMongoUri = async (uri: string): Promise<string> => {
  if (!uri.startsWith("mongodb+srv://")) {
    return uri;
  }

  const parsed = new URL(uri);
  const clusterHost = parsed.hostname;
  if (!clusterHost) {
    return uri;
  }

  const srvName = `_mongodb._tcp.${clusterHost}`;
  const srvResponse = await fetchDnsJson(srvName, "SRV");
  const txtResponse = await fetchDnsJson(clusterHost, "TXT");

  const hosts = parseSrvRecords(srvResponse.Answer);
  if (hosts.length === 0) {
    throw new Error("mongodb SRV records not found via DoH");
  }

  const query = new URLSearchParams(parsed.search);
  const txtParams = parseTxtRecords(txtResponse.Answer);
  txtParams.forEach((value, key) => {
    if (!query.has(key)) query.set(key, value);
  });

  if (!query.has("tls")) query.set("tls", "true");

  const authPart = getAuthPart(uri);
  const authPrefix = authPart ? `${authPart}@` : "";
  const path = parsed.pathname && parsed.pathname !== "" ? parsed.pathname : "/";
  const queryString = query.toString();
  return `mongodb://${authPrefix}${hosts.join(",")}${path}${queryString ? `?${queryString}` : ""}`;
};
