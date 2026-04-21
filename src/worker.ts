interface Env {
  APP_CACHE: KVNamespace;
  FX_CACHE: KVNamespace;
  ASSETS: Fetcher;
}

type Area = {
  code: string;
  name: string;
  currency: string;
  currencyCode: string;
  thousandsSeparator: "," | ".";
  inAppPurchaseStr: string;
  locale: string;
};

type Money = {
  area: string;
  areaName: string;
  currency: string;
  currencyCode: string;
  locale: string;
  price: number;
  cnyPrice: number;
};

type InAppPurchase = {
  object: string;
  price: Money;
};

type AppListItem = {
  appId: string;
  appName: string;
  appImage: string;
  appDesc: string;
  platform: string;
};

type AppInfoItem = {
  appId: string;
  area: string;
  areaName: string;
  name: string;
  subtitle: string;
  developer: string;
  appStoreUrl: string;
  price: Money;
  inAppPurchaseList: InAppPurchase[];
};

type AppInfoComparisonItem = {
  object: string;
  priceList: Money[];
};

type R<T> = {
  code: number;
  message: string;
  data: T;
};

const ONE_DAY = 86400;
const FX_CACHE_KEY = "fx:latest";
const FX_CACHE_UPDATED_AT = "fx:updatedAt";
const POPULAR_WORDS_KEY = "popular:words";

const AREAS: Area[] = [
  { code: "us", name: "美国", currency: "$", currencyCode: "USD", thousandsSeparator: ",", inAppPurchaseStr: "In-App Purchases", locale: "en-US" },
  { code: "cn", name: "中国", currency: "¥", currencyCode: "CNY", thousandsSeparator: ",", inAppPurchaseStr: "App内购买", locale: "zh-CN" },
  { code: "tw", name: "台湾", currency: "NT$", currencyCode: "TWD", thousandsSeparator: ",", inAppPurchaseStr: "App內購買", locale: "zh-TW" },
  { code: "hk", name: "香港", currency: "HK$", currencyCode: "HKD", thousandsSeparator: ",", inAppPurchaseStr: "App 內購買", locale: "zh-HK" },
  { code: "jp", name: "日本", currency: "¥", currencyCode: "JPY", thousandsSeparator: ",", inAppPurchaseStr: "アプリ内購入", locale: "ja-JP" },
  { code: "kr", name: "韩国", currency: "₩", currencyCode: "KRW", thousandsSeparator: ",", inAppPurchaseStr: "앱 내 구입", locale: "ko-KR" },
  { code: "tr", name: "土耳其", currency: "₺", currencyCode: "TRY", thousandsSeparator: ".", inAppPurchaseStr: "In-App Purchases", locale: "tr-TR" },
  { code: "ng", name: "尼日利亚", currency: "₦", currencyCode: "NGN", thousandsSeparator: ",", inAppPurchaseStr: "In-App Purchases", locale: "en-NG" },
  { code: "in", name: "印度", currency: "₹", currencyCode: "INR", thousandsSeparator: ",", inAppPurchaseStr: "In-App Purchases", locale: "en-IN" },
  { code: "pk", name: "巴基斯坦", currency: "₨", currencyCode: "PKR", thousandsSeparator: ",", inAppPurchaseStr: "In-App Purchases", locale: "en-PK" },
  { code: "br", name: "巴西", currency: "R$", currencyCode: "BRL", thousandsSeparator: ".", inAppPurchaseStr: "Compras dentro do app", locale: "pt-BR" },
  { code: "eg", name: "埃及", currency: "E£", currencyCode: "EGP", thousandsSeparator: ",", inAppPurchaseStr: "In-App Purchases", locale: "ar-EG-u-nu-latn" },
];

const AREA_BY_CODE = new Map(AREAS.map((item) => [item.code, item]));
const AREA_BY_CURRENCY = new Map(AREAS.map((item) => [item.currencyCode, item]));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      const url = new URL(request.url);
      const path = trimPath(url.pathname);

      if (request.method === "POST" && path === "/app/getAreaList") {
        return json(ok(AREAS.map((item) => ({ code: item.code, name: item.name }))));
      }

      if (request.method === "POST" && path === "/app/getPopularSearchWordList") {
        return json(ok(await getPopularWords(env)));
      }

      if (request.method === "POST" && path === "/app/getAppList") {
        const body = await parseJsonBody<{ appName?: string; areaCode?: string }>(request);
        const appName = (body.appName ?? "").trim();
        const areaCode = (body.areaCode ?? "").trim().toLowerCase();
        if (!appName) return json(fail("appName can not be blank"));
        if (appName.length > 20) return json(fail("appName length must be less than or equal to 20"));
        if (!areaCode) return json(fail("areaCode can not be blank"));
        if (!AREA_BY_CODE.has(areaCode)) return json(fail(`area not found, areaCode: ${areaCode}`));

        const data = await getAppList(env, areaCode, appName);
        return json(ok(data));
      }

      if (request.method === "POST" && path === "/app/getAppInfo") {
        const body = await parseJsonBody<{ appId?: string }>(request);
        const appId = (body.appId ?? "").trim();
        if (!appId) return json(fail("appId can not be blank"));
        const data = await getAppInfo(env, appId);
        return json(ok(data));
      }

      if (request.method === "POST" && path === "/app/getAppInfoComparison") {
        const body = await parseJsonBody<{ appId?: string }>(request);
        const appId = (body.appId ?? "").trim();
        if (!appId) return json(fail("appId can not be blank"));
        const data = await getAppInfoComparison(env, appId);
        return json(ok(data));
      }

      return withCors(await env.ASSETS.fetch(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return json(fail(message));
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await refreshExchangeRates(env);
  },
};

async function getAppList(env: Env, areaCode: string, appName: string): Promise<AppListItem[]> {
  await increasePopularWord(env, appName);

  const cacheKey = `app-list:${areaCode}:${appName.toLowerCase()}`;
  const cached = await getJSON<AppListItem[]>(env.APP_CACHE, cacheKey);
  if (cached?.length) {
    return cached.map((item) => ({
      ...item,
      appImage: normalizeAppImageTemplate(item.appImage),
    }));
  }

  const platforms = ["iphone", "ipad", "mac", "tv"];
  const platformResults = await Promise.all(
    platforms.map(async (platform) => {
      const searchUrl = `https://apps.apple.com/${areaCode}/${platform}/search?term=${encodeURIComponent(appName)}`;
      const html = await fetchText(searchUrl, AREA_BY_CODE.get(areaCode)?.locale ?? "en-US");
      const parsed = extractSerializedData(html);
      const items = deepGet(parsed, ["data", 0, "data", "shelves", 0, "items"], []) as unknown[];
      const result: AppListItem[] = [];
      for (const item of items) {
        const lockup = deepGet(item, ["lockup"], null) as Record<string, unknown> | null;
        if (!lockup) continue;
        if (deepGet(item, ["resultType"], "") === "bundle") continue;
        result.push({
          appId: String(deepGet(lockup, ["adamId"], "")),
          appName: String(deepGet(lockup, ["title"], "")),
          appImage: normalizeAppImageTemplate(String(deepGet(lockup, ["icon", "template"], ""))),
          appDesc: String(deepGet(lockup, ["subtitle"], "")),
          platform,
        });
      }
      return result;
    }),
  );

  const all = platformResults.flat().filter((item) => item.appId);
  const merged = new Map<string, AppListItem>();
  for (const item of all) {
    const existing = merged.get(item.appId);
    if (!existing || existing.platform !== "iphone") {
      merged.set(item.appId, item);
    }
  }

  const sorted = [...merged.values()].sort((a, b) => {
    const rankDiff = rankByQuery(a.appName, appName) - rankByQuery(b.appName, appName);
    if (rankDiff !== 0) return rankDiff;
    return a.appName.localeCompare(b.appName);
  });

  await putJSON(env.APP_CACHE, cacheKey, sorted, ONE_DAY);
  return sorted;
}

async function getAppInfo(env: Env, appId: string): Promise<AppInfoItem[]> {
  const cacheKey = `app-info:${appId}`;
  const cached = await getJSON<AppInfoItem[]>(env.APP_CACHE, cacheKey);
  if (cached?.length) return cached;

  const rates = await getExchangeRates(env);
  const results = await Promise.all(AREAS.map(async (area) => fetchAppInfoByArea(appId, area, rates)));
  const filtered = results.filter((item): item is AppInfoItem => item !== null);

  filtered.sort((a, b) => {
    const minA = Math.min(...a.inAppPurchaseList.map((item) => item.price.cnyPrice), 0);
    const minB = Math.min(...b.inAppPurchaseList.map((item) => item.price.cnyPrice), 0);
    if (minA !== minB) return minA - minB;
    return a.price.cnyPrice - b.price.cnyPrice;
  });

  await putJSON(env.APP_CACHE, cacheKey, filtered, ONE_DAY);
  return filtered;
}

async function fetchAppInfoByArea(appId: string, area: Area, rates: Record<string, number>): Promise<AppInfoItem | null> {
  const appStoreUrl = `https://apps.apple.com/${area.code}/app/id${appId}`;
  const response = await fetch(appStoreUrl, {
    headers: {
      "accept-language": area.locale,
      "user-agent": "Mozilla/5.0 (compatible; app-store-price-worker/1.0)",
    },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const parsed = extractSerializedData(html);
  const jsonResult = deepGet(parsed, ["data", 0, "data"], null) as Record<string, unknown> | null;
  if (!jsonResult) return null;

  const purchaseSection = (deepGet(jsonResult, ["shelfMapping", "information", "items"], []) as Array<Record<string, unknown>>).find(
    (item) => deepGet(item, ["title"], "") === area.inAppPurchaseStr,
  );
  const textPairs = deepGet(purchaseSection, ["items", 0, "textPairs"], []) as Array<[string, string]>;
  const inAppPurchaseList = textPairs
    .map((pair) => ({
      object: String(pair?.[0] ?? ""),
      price: buildMoney(parsePrice(String(pair?.[1] ?? ""), area), area, rates),
    }))
    .filter((item) => item.object);

  return {
    appId,
    area: area.code,
    areaName: area.name,
    name: String(deepGet(jsonResult, ["title"], "")),
    subtitle: String(deepGet(jsonResult, ["lockup", "subtitle"], "")),
    developer: String(deepGet(jsonResult, ["developerAction", "title"], "")),
    appStoreUrl,
    price: buildMoney(parsePrice(String(deepGet(jsonResult, ["lockup", "offerDisplayProperties", "priceFormatted"], "")), area), area, rates),
    inAppPurchaseList,
  };
}

async function getAppInfoComparison(env: Env, appId: string): Promise<AppInfoComparisonItem[]> {
  const appInfoList = await getAppInfo(env, appId);
  if (!appInfoList.length) return [];

  const comparisonMap = new Map<string, Money[]>();
  comparisonMap.set("软件本体", appInfoList.map((item) => item.price));

  for (const appInfo of appInfoList) {
    const sorted = [...appInfo.inAppPurchaseList].sort((a, b) => a.price.cnyPrice - b.price.cnyPrice);
    const objectCounter = new Map<string, number>();
    for (const purchase of sorted) {
      const count = (objectCounter.get(purchase.object) ?? 0) + 1;
      objectCounter.set(purchase.object, count);
      const key = count > 1 ? `${purchase.object} #${count}` : purchase.object;
      if (!comparisonMap.has(key)) comparisonMap.set(key, []);
      comparisonMap.get(key)!.push(purchase.price);
    }
  }

  return [...comparisonMap.entries()]
    .map(([object, priceList]) => ({
      object,
      priceList: [...priceList].sort((a, b) => a.cnyPrice - b.cnyPrice),
    }))
    .sort((a, b) => b.priceList.length - a.priceList.length);
}

async function getExchangeRates(env: Env): Promise<Record<string, number>> {
  const cached = await getJSON<Record<string, number>>(env.FX_CACHE, FX_CACHE_KEY);
  if (cached) return cached;
  return refreshExchangeRates(env);
}

async function refreshExchangeRates(env: Env): Promise<Record<string, number>> {
  const response = await fetch("https://open.er-api.com/v6/latest/CNY", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; app-store-price-worker/1.0)" },
  });
  if (!response.ok) throw new Error(`fetch exchange rates failed: ${response.status}`);
  const data = (await response.json()) as { rates?: Record<string, number> };
  const rates = data.rates ?? {};
  if (!Object.keys(rates).length) throw new Error("exchange rates is empty");
  await putJSON(env.FX_CACHE, FX_CACHE_KEY, rates, ONE_DAY);
  await env.FX_CACHE.put(FX_CACHE_UPDATED_AT, String(Date.now()), { expirationTtl: ONE_DAY });
  return rates;
}

function buildMoney(price: number, area: Area, rates: Record<string, number>): Money {
  const cnyPrice = convertToCny(price, area.currencyCode, rates);
  return {
    area: area.code,
    areaName: area.name,
    currency: area.currency,
    currencyCode: area.currencyCode,
    locale: area.locale,
    price,
    cnyPrice,
  };
}

function parsePrice(priceStr: string, area: Area): number {
  if (!priceStr) return 0;
  let normalized = priceStr.replaceAll(area.thousandsSeparator, "");
  if (area.thousandsSeparator === ".") {
    normalized = normalized.replaceAll(",", ".");
  }
  const matched = normalized.match(/\d+(?:\.\d+)?/);
  if (!matched) return 0;
  return round(Number.parseFloat(matched[0]), 2);
}

function convertToCny(amount: number, currencyCode: string, rates: Record<string, number>): number {
  if (currencyCode === "CNY") return round(amount, 2);
  const rate = rates[currencyCode];
  if (!rate || rate <= 0) return round(amount, 2);
  return round(amount / rate, 2);
}

async function increasePopularWord(env: Env, word: string): Promise<void> {
  const normalized = word.trim();
  if (!normalized) return;
  const counts = (await getJSON<Record<string, number>>(env.APP_CACHE, POPULAR_WORDS_KEY)) ?? {};
  counts[normalized] = (counts[normalized] ?? 0) + 1;
  await putJSON(env.APP_CACHE, POPULAR_WORDS_KEY, counts, 30 * ONE_DAY);
}

async function getPopularWords(env: Env): Promise<string[]> {
  const counts = (await getJSON<Record<string, number>>(env.APP_CACHE, POPULAR_WORDS_KEY)) ?? {};
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function extractSerializedData(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    throw new Error("serialized-server-data not found");
  }
  return JSON.parse(match[1].trim()) as Record<string, unknown>;
}

function rankByQuery(name: string, query: string): number {
  const a = name.toLowerCase();
  const b = query.toLowerCase();
  if (a === b) return 0;
  if (a.startsWith(b)) return 1;
  if (b.split("").every((char) => a.includes(char))) return 2;
  return 3;
}

function trimPath(path: string): string {
  if (path.length > 1) return path.replace(/\/+$/, "");
  return path;
}

function ok<T>(data: T): R<T> {
  return { code: 0, message: "成功", data };
}

function fail(message: string): R<null> {
  return { code: 1, message, data: null };
}

function json<T>(data: T): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("invalid json body");
  }
}

async function fetchText(url: string, locale: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "accept-language": locale,
      "user-agent": "Mozilla/5.0 (compatible; app-store-price-worker/1.0)",
    },
  });
  if (!response.ok) throw new Error(`request failed: ${url}, status: ${response.status}`);
  return response.text();
}

async function getJSON<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

async function putJSON(kv: KVNamespace, key: string, value: unknown, expirationTtl: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl });
}

function deepGet(value: unknown, path: Array<string | number>, fallback: unknown): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return fallback;
    if (typeof key === "number") {
      if (!Array.isArray(cursor) || key >= cursor.length) return fallback;
      cursor = cursor[key];
    } else {
      if (typeof cursor !== "object" || !(key in (cursor as Record<string, unknown>))) return fallback;
      cursor = (cursor as Record<string, unknown>)[key];
    }
  }
  return cursor ?? fallback;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeAppImageTemplate(template: string): string {
  if (!template) return "";
  const normalized = template
    .replace(/%7Bw%7D/gi, "{w}")
    .replace(/%7Bh%7D/gi, "{h}")
    .replace(/%7Bc%7D/gi, "{c}")
    .replace(/%7Bf%7D/gi, "{f}");
  return normalized
    .replace("{w}", "512")
    .replace("{h}", "512")
    .replace("{c}", "bb")
    .replace("{f}", "jpg");
}
