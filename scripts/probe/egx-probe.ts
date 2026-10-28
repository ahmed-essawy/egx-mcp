interface ProbeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ProbeEnv {
  PROBE_RL?: ProbeRateLimiter;
}

const USER_AGENT = "egx-mcp/1.0 (+https://github.com/ahmed-essawy/egx-mcp)";
const TIMEOUT_MS = 8000;
const RATE_LIMIT_CALLS = 11;

const EGX_URLS = [
  "https://www.egx.com.eg/en/homepage.aspx",
  "https://www.egx.com.eg/ar/homepage.aspx",
  "https://www.egx.com.eg/en/prices.aspx",
  "https://www.egx.com.eg/en/ListedStocks.aspx",
  "https://www.egx.com.eg/en/Indices.aspx",
  "https://www.egx.com.eg/WebService.asmx/getIndexChartData?index=EGX30&period=30&gtk=0",
];

const TRADINGVIEW_URL = "https://scanner.tradingview.com/egypt/scan";
const MUBASHER_URL = "https://www.mubasher.info/api/1/stocks/prices/all?country=eg";
const ISAGHA_URL = "https://market.isagha.com/prices";
const ISAGHA_ROW_PATTERN = /<tr\b[^>]*data-testid="prices-row"/g;

const TRADINGVIEW_BODY = {
  columns: [
    "name",
    "description",
    "isin",
    "sector",
    "close",
    "open",
    "high",
    "low",
    "change",
    "change_abs",
    "volume",
    "Value.Traded",
    "time",
    "update_time",
    "type",
    "total_shares_outstanding",
    "float_shares_outstanding",
  ],
  range: [0, 400],
};

interface EgxResult {
  url: string;
  status: number | null;
  bytes: number | null;
  contentType: string | null;
  head500: string | null;
  containsCOMI: boolean | null;
  error: string | null;
}

interface CountResult {
  status: number | null;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ProbeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fetchWithTimeout(url: string, init: ProbeRequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function probeEgx(url: string): Promise<EgxResult> {
  try {
    const response = await fetchWithTimeout(url);
    const buffer = await response.arrayBuffer();
    const body = new TextDecoder().decode(buffer);
    return {
      url,
      status: response.status,
      bytes: buffer.byteLength,
      contentType: response.headers.get("content-type"),
      head500: body.slice(0, 500),
      containsCOMI: body.includes("COMI"),
      error: null,
    };
  } catch (error) {
    return {
      url,
      status: null,
      bytes: null,
      contentType: null,
      head500: null,
      containsCOMI: null,
      error: errorMessage(error),
    };
  }
}

async function readJson<T>(response: Response): Promise<{ json: T } | { error: string }> {
  try {
    return { json: (await response.json()) as T };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function probeTradingView(): Promise<CountResult & { totalCount: number | null }> {
  try {
    const response = await fetchWithTimeout(TRADINGVIEW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TRADINGVIEW_BODY),
    });
    const parsed = await readJson<{ totalCount?: unknown }>(response);
    if ("error" in parsed) {
      return { status: response.status, totalCount: null, error: parsed.error };
    }
    const totalCount = typeof parsed.json.totalCount === "number" ? parsed.json.totalCount : null;
    return { status: response.status, totalCount, error: null };
  } catch (error) {
    return { status: null, totalCount: null, error: errorMessage(error) };
  }
}

async function probeMubasher(): Promise<CountResult & { rows: number | null }> {
  try {
    const response = await fetchWithTimeout(MUBASHER_URL);
    const parsed = await readJson<{ prices?: unknown }>(response);
    if ("error" in parsed) {
      return { status: response.status, rows: null, error: parsed.error };
    }
    const rows = Array.isArray(parsed.json.prices) ? parsed.json.prices.length : null;
    return { status: response.status, rows, error: null };
  } catch (error) {
    return { status: null, rows: null, error: errorMessage(error) };
  }
}

async function probeIsagha(): Promise<CountResult & { rowsFound: number | null }> {
  try {
    const response = await fetchWithTimeout(ISAGHA_URL);
    try {
      const html = await response.text();
      const rowsFound = html.match(ISAGHA_ROW_PATTERN)?.length ?? 0;
      return { status: response.status, rowsFound, error: null };
    } catch (error) {
      return { status: response.status, rowsFound: null, error: errorMessage(error) };
    }
  } catch (error) {
    return { status: null, rowsFound: null, error: errorMessage(error) };
  }
}

async function probeRateLimit(limiter: ProbeRateLimiter | undefined) {
  if (!limiter) {
    return { bindingPresent: false, firstCallSuccess: null, eleventhCallSuccess: null, error: null };
  }
  try {
    const outcomes: boolean[] = [];
    for (let call = 0; call < RATE_LIMIT_CALLS; call++) {
      outcomes.push((await limiter.limit({ key: "probe" })).success);
    }
    return {
      bindingPresent: true,
      firstCallSuccess: outcomes[0] ?? null,
      eleventhCallSuccess: outcomes[RATE_LIMIT_CALLS - 1] ?? null,
      error: null,
    };
  } catch (error) {
    return {
      bindingPresent: true,
      firstCallSuccess: null,
      eleventhCallSuccess: null,
      error: errorMessage(error),
    };
  }
}

async function run(env: ProbeEnv) {
  const egx = await Promise.all(EGX_URLS.map(probeEgx));
  const [tradingview, mubasher, isagha, rateLimit] = await Promise.all([
    probeTradingView(),
    probeMubasher(),
    probeIsagha(),
    probeRateLimit(env.PROBE_RL),
  ]);
  return { checkedAt: new Date().toISOString(), egx, tradingview, mubasher, isagha, rateLimit };
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" || pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json(await run(env));
  },
};
