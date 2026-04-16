import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const solvedBaseUrl = "https://solved.ac/api/v3";
const bojBaseUrl = "https://www.acmicpc.net";
const readerBaseUrl = "https://r.jina.ai/http://r.jina.ai/http://";
const imageProxyAllowedHosts = new Set(["static.solved.ac", "ui-avatars.com"]);
const imageProxyMaxBytes = 5 * 1024 * 1024;
const upstreamJsonMaxBytes = 2 * 1024 * 1024;
const upstreamTextMaxBytes = 3 * 1024 * 1024;
const appContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https://static.solved.ac https://ui-avatars.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const baseSecurityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "x-frame-options": "DENY",
};
const imageContentTypesByExtension = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);
const upstreamTimeoutMs = 9000;
const memoryCacheTtlMs = 5 * 60 * 1000;
const memoryCacheMaxEntries = 500;
const rateLimitWindowMs = 60 * 1000;
const memoryRateLimitMax = 24;
const imageRateLimitMax = 120;
const rateLimitMaxKeys = 1000;
const allowedFrontendOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);
if (process.env.VERCEL_URL) {
  allowedFrontendOrigins.add(`https://${process.env.VERCEL_URL}`);
}
for (const origin of (process.env.BOJ_MEMORY_FRONTEND_ORIGINS || "").split(",")) {
  if (origin.trim()) {
    allowedFrontendOrigins.add(origin.trim().replace(/\/$/, ""));
  }
}
const memoryCache = new Map();
const memoryRateLimits = new Map();
const imageRateLimits = new Map();
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function securityHeaders(extraHeaders = {}) {
  return {
    ...baseSecurityHeaders,
    ...extraHeaders,
  };
}

function appSecurityHeaders(extraHeaders = {}) {
  return securityHeaders({
    "content-security-policy": appContentSecurityPolicy,
    ...extraHeaders,
  });
}

function originFromHeader(value) {
  if (typeof value !== "string" || !value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestSourceOrigin(req) {
  return originFromHeader(req.headers.origin) || originFromHeader(req.headers.referer);
}

function requestOrigin(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || !host) return null;

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = typeof forwardedProto === "string" && forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  return `${proto}://${host}`;
}

function isAllowedFrontendOrigin(req, origin) {
  if (!origin) return true;
  if (origin === requestOrigin(req)) return true;
  if (allowedFrontendOrigins.has(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function corsHeaders(req, extraHeaders = {}) {
  const origin = originFromHeader(req.headers.origin);
  const headers = { ...extraHeaders };
  if (origin && isAllowedFrontendOrigin(req, origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = headers.vary ? `${headers.vary}, Origin` : "Origin";
  }
  return headers;
}

function validateFrontendRequest(req, res) {
  const origin = requestSourceOrigin(req);
  if (isAllowedFrontendOrigin(req, origin)) return true;

  res.writeHead(403, {
    ...securityHeaders(),
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("Forbidden");
  return false;
}

function handleApiOptions(req, res) {
  if (!validateFrontendRequest(req, res)) return;

  res.writeHead(204, corsHeaders(req, securityHeaders({
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  })));
  res.end();
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, corsHeaders(req, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })));
  res.end(body);
}

function clientKey(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  if (store.size > rateLimitMaxKeys) {
    pruneExpiringStore(store, "resetAt", now, rateLimitMaxKeys);
  }

  const current = store.get(key);

  if (!current || now >= current.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  current.count += 1;
  return current.count <= limit;
}

function pruneExpiringStore(store, expiresAtKey, now = Date.now(), maxEntries = Number.POSITIVE_INFINITY) {
  for (const [key, value] of store) {
    if (value?.[expiresAtKey] <= now) {
      store.delete(key);
    }
  }

  while (store.size > maxEntries) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = upstreamTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    const error = new Error("Image is too large");
    error.status = 413;
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxBytes) {
      const error = new Error("Image is too large");
      error.status = 413;
      throw error;
    }
    return body;
  }

  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      const error = new Error("Image is too large");
      error.status = 413;
      throw error;
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

async function readTextWithLimit(response, maxBytes) {
  return (await readBodyWithLimit(response, maxBytes)).toString("utf8");
}

async function readJsonWithLimit(response, maxBytes, fallbackMessage) {
  const text = await readTextWithLimit(response, maxBytes);

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(fallbackMessage);
    error.status = 502;
    throw error;
  }
}

function imageContentTypeFromPath(pathname) {
  return imageContentTypesByExtension.get(extname(pathname).toLowerCase()) || null;
}

async function proxyImageRequest(req, res) {
  if (!validateFrontendRequest(req, res)) return;

  const key = `${clientKey(req)}:image`;
  if (!checkRateLimit(imageRateLimits, key, imageRateLimitMax, rateLimitWindowMs)) {
    res.writeHead(429, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
    res.end("Too many requests");
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const imageUrl = requestUrl.searchParams.get("url");

  if (!imageUrl) {
    res.writeHead(400, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
    res.end("Missing image url");
    return;
  }

  let target;
  try {
    target = new URL(imageUrl);
  } catch {
    res.writeHead(400, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
    res.end("Invalid image url");
    return;
  }

  if (target.protocol !== "https:" || !imageProxyAllowedHosts.has(target.hostname)) {
    res.writeHead(400, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
    res.end("Unsupported image url");
    return;
  }

  try {
    const response = await fetchWithTimeout(target, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "goodbye-boj/0.1",
      },
    });

    if (!response.ok) {
      res.writeHead(response.status, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
      res.end("Image request failed");
      return;
    }

    const upstreamContentType = response.headers.get("content-type") || "application/octet-stream";
    const inferredContentType = imageContentTypeFromPath(target.pathname);
    const contentType = upstreamContentType.toLowerCase().startsWith("image/")
      ? upstreamContentType
      : inferredContentType;
    if (!contentType) {
      res.writeHead(415, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
      res.end("Unsupported image response");
      return;
    }

    const body = await readBodyWithLimit(response, imageProxyMaxBytes);
    res.writeHead(200, corsHeaders(req, securityHeaders({
      "content-security-policy": "default-src 'none'; script-src 'none'; object-src 'none'; sandbox",
      "content-type": contentType,
      "cache-control": "public, max-age=86400",
    })));
    res.end(body);
  } catch (error) {
    res.writeHead(error.status || 502, corsHeaders(req, securityHeaders({ "content-type": "text/plain; charset=utf-8" })));
    res.end(error.status === 413 ? "Image is too large" : "Image proxy failed");
  }
}

function serializeQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

async function fetchSolved(path, params = {}) {
  const query = serializeQuery(params);
  const url = `${solvedBaseUrl}${path}${query ? `?${query}` : ""}`;
  try {
    return await fetchSolvedDirect(url);
  } catch (error) {
    if (error.status && error.status !== 403) {
      throw error;
    }

    return fetchSolvedThroughReader(url);
  }
}

async function fetchSolvedDirect(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "x-solvedac-language": "ko",
      "user-agent": "goodbye-boj/0.1",
    },
  });

  if (!response.ok) {
    const message = response.status === 404 ? "찾을 수 없는 사용자입니다." : "solved.ac API 요청에 실패했습니다.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return readJsonWithLimit(response, upstreamJsonMaxBytes, "solved.ac API 응답을 해석하지 못했습니다.");
}

async function fetchSolvedThroughReader(url) {
  const response = await fetchWithTimeout(`${readerBaseUrl}${url}`, {
    headers: {
      accept: "text/plain",
      "user-agent": "goodbye-boj/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error("solved.ac API 요청에 실패했습니다.");
    error.status = response.status;
    throw error;
  }

  const text = await readTextWithLimit(response, upstreamTextMaxBytes);
  const marker = "Markdown Content:";
  const jsonStart = text.indexOf(marker);
  const jsonText = jsonStart >= 0 ? text.slice(jsonStart + marker.length).trim() : text.trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    const error = new Error("solved.ac API 응답을 해석하지 못했습니다.");
    error.status = 502;
    throw error;
  }
}

async function fetchOptional(path, params) {
  try {
    return await fetchSolved(path, params);
  } catch {
    return null;
  }
}

async function fetchOptionalBojStats(handle) {
  try {
    return await fetchBojProfileStats(handle);
  } catch {
    return [];
  }
}

async function fetchOptionalBojLanguageStats(handle) {
  try {
    return await fetchBojLanguageStats(handle);
  } catch {
    return [];
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const ignoredBojStatLabels = new Set(["codeforces", "atcoder", "topcoder", "학교/회사"]);

function normalizeBojStatLabel(label) {
  return label.toLowerCase().replace(/\s+/g, "");
}

function shouldIgnoreBojStat(label) {
  return ignoredBojStatLabels.has(normalizeBojStatLabel(label));
}

function parseBojStats(html) {
  const table = html.match(/<table[^>]*id=["']statics["'][\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];

  const stats = [];
  const rowPattern = /<tr>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;

  while ((match = rowPattern.exec(table))) {
    const labelHtml = match[1];
    const label = stripHtml(match[1]);
    if (shouldIgnoreBojStat(label)) continue;

    const textValue = stripHtml(match[2]);
    const numberText = textValue.match(/[\d,]+/)?.[0];
    if (!numberText) continue;

    stats.push({
      label,
      value: Number(numberText.replace(/,/g, "")),
      styleClass: labelHtml.match(/\b(result-[a-z]+)\b/)?.[1] ?? null,
    });
  }

  return stats;
}

async function fetchBojProfileStats(handle) {
  const response = await fetchWithTimeout(`${bojBaseUrl}/user/${encodeURIComponent(handle)}`, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "user-agent": "goodbye-boj/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error("BOJ 프로필 정보를 가져오지 못했습니다.");
    error.status = response.status;
    throw error;
  }

  return parseBojStats(await readTextWithLimit(response, upstreamTextMaxBytes));
}

function getTableCells(rowHtml) {
  const cells = [];
  const cellPattern = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
  let match;

  while ((match = cellPattern.exec(rowHtml))) {
    cells.push(match[1]);
  }

  return cells;
}

function parseBojLanguageStats(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const table = tables.find((candidate) => {
    const text = stripHtml(candidate);
    return text.includes("언어") && text.includes("정답 비율");
  });
  if (!table) return [];

  const headerRow = table.match(/<thead[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i)?.[1];
  if (!headerRow) return [];

  const headers = getTableCells(headerRow).map((cellHtml) => ({
    label: stripHtml(cellHtml),
    styleClass: cellHtml.match(/\b(result-[a-z]+)\b/)?.[1] ?? null,
  }));
  const rows = table.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  return rows
    .map((rowHtml) => {
      const cells = getTableCells(rowHtml);
      const language = stripHtml(cells[0] ?? "");
      if (!language) return null;

      const stats = headers.slice(1).map((header, index) => {
        const text = stripHtml(cells[index + 1] ?? "");
        const numericText = text.match(/[\d,]+(?:\.\d+)?/)?.[0];
        const value = numericText ? Number(numericText.replace(/,/g, "")) : 0;
        return {
          label: header.label,
          value,
          text,
          styleClass: header.styleClass,
        };
      });
      const statuses = stats.filter((stat) => stat.styleClass?.startsWith("result-"));

      return {
        language,
        statuses,
        solvedProblems: stats.find((stat) => stat.label === "맞은 문제")?.value ?? 0,
        submissions: stats.find((stat) => stat.label === "제출")?.value ?? 0,
        acceptedRate: stats.find((stat) => stat.label === "정답 비율")?.text ?? "0.000%",
      };
    })
    .filter(Boolean);
}

async function fetchBojLanguageStats(handle) {
  const response = await fetchWithTimeout(`${bojBaseUrl}/user/language/${encodeURIComponent(handle)}`, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "user-agent": "goodbye-boj/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error("BOJ 언어 정보를 가져오지 못했습니다.");
    error.status = response.status;
    throw error;
  }

  return parseBojLanguageStats(await readTextWithLimit(response, upstreamTextMaxBytes));
}

function normalizeProblemList(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.data?.items)
          ? payload.data.items
          : [];

  return items.slice(0, 100).map((problem) => ({
    problemId: problem.problemId,
    titleKo: problem.titleKo,
    level: problem.level,
  }));
}

function getClassLabel(user) {
  if (!user?.class) return "CLASS 없음";
  const decoration = {
    none: "",
    silver: "s",
    gold: "g",
  }[user.classDecoration] ?? "";

  return `CLASS ${user.class}${decoration}`;
}

async function handleMemoryRequest(req, res) {
  if (!validateFrontendRequest(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const handle = url.searchParams.get("handle")?.trim();

  if (!handle) {
    sendJson(req, res, 400, { message: "유저명을 입력해주세요." });
    return;
  }

  if (!/^[A-Za-z0-9_]{2,20}$/.test(handle)) {
    sendJson(req, res, 400, { message: "BOJ 유저명 형식이 올바르지 않습니다." });
    return;
  }

  const key = `${clientKey(req)}:memory`;
  if (!checkRateLimit(memoryRateLimits, key, memoryRateLimitMax, rateLimitWindowMs)) {
    sendJson(req, res, 429, { message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  const cacheKey = handle.toLowerCase();
  if (memoryCache.size > memoryCacheMaxEntries) {
    pruneExpiringStore(memoryCache, "expiresAt", Date.now(), memoryCacheMaxEntries);
  }

  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    sendJson(req, res, 200, cached.payload);
    return;
  }

  try {
    const user = await fetchSolved("/user/show", { handle });
    const [badge, background, classStats, topProblems, bojStats, languageStats] = await Promise.all([
      user.badgeId ? fetchOptional("/badge/show", { badgeId: user.badgeId }) : null,
      user.backgroundId ? fetchOptional("/background/show", { backgroundId: user.backgroundId }) : null,
      fetchOptional("/user/class_stats", { handle }),
      fetchOptional("/user/top_100", { handle }),
      fetchOptionalBojStats(handle),
      fetchOptionalBojLanguageStats(handle),
    ]);

    const payload = {
      fetchedAt: new Date().toISOString(),
      user,
      badge,
      background,
      classStats: Array.isArray(classStats) ? classStats : (classStats?.data ?? []),
      topProblems: normalizeProblemList(topProblems),
      bojStats,
      languageStats,
      stats: {
        solvedCount: user.solvedCount,
        contributionCount: user.voteCount,
        rivalCount: user.rivalCount,
        rating: user.rating,
        classLabel: getClassLabel(user),
      },
    };

    memoryCache.set(cacheKey, {
      expiresAt: Date.now() + memoryCacheTtlMs,
      payload,
    });
    if (memoryCache.size > memoryCacheMaxEntries) {
      pruneExpiringStore(memoryCache, "expiresAt", Date.now(), memoryCacheMaxEntries);
    }
    sendJson(req, res, 200, payload);
  } catch (error) {
    sendJson(req, res, error.status || 500, {
      message: error.message || "잠시 후 다시 시도해주세요.",
    });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Bad request");
    return;
  }

  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = safePath === "/" ? join(publicDir, "index.html") : join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, appSecurityHeaders({
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    }));
    res.end(body);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, appSecurityHeaders({
      "content-type": contentTypes[".html"],
      "cache-control": "no-store",
    }));
    res.end(fallback);
  }
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    handleApiOptions(req, res);
    return;
  }

  if (req.url?.startsWith("/api/memory")) {
    handleMemoryRequest(req, res);
    return;
  }

  if (req.url?.startsWith("/api/image")) {
    proxyImageRequest(req, res);
    return;
  }

  serveStatic(req, res);
});

export { corsHeaders, handleApiOptions, handleMemoryRequest, proxyImageRequest, securityHeaders, validateFrontendRequest };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  server.listen(port, () => {
    console.log(`Goodbye BOJ is running at http://localhost:${port}`);
  });
}
