import { createServer } from "node:http";
import { createHash, createHmac } from "node:crypto";
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
const backupTextMaxBytes = 2 * 1024 * 1024;
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
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
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
const backupImportRateLimitMax = 12;
const rateLimitMaxKeys = 1000;
const backupSignatureSecret = process.env.BOJ_MEMORY_BACKUP_SECRET || "";
const backupSignaturePattern = /^[a-f0-9]{64}$/;
const allowedBackupStyleClasses = new Set([null, "result-ac", "result-pe", "result-wa", "result-tle", "result-mle", "result-ole", "result-rte", "result-ce", "result-del"]);
const allowedClassDecorations = new Set([null, "none", "silver", "gold"]);
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

function pathnameFromRequest(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
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
  if (!origin) return false;
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  })));
  res.end();
}

function sendPlainText(req, res, status, message, extraHeaders = {}) {
  res.writeHead(status, corsHeaders(req, securityHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  })));
  res.end(message);
}

function allowMethods(req, res, methods) {
  const allow = methods.join(", ");
  sendPlainText(req, res, 405, "Method not allowed", { allow });
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

async function readRequestBodyWithLimit(req, maxBytes) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBytes) {
    const error = new Error("Request body is too large");
    error.status = 413;
    throw error;
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

async function readRequestTextWithLimit(req, maxBytes) {
  return (await readRequestBodyWithLimit(req, maxBytes)).toString("utf8");
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
  if (req.method !== "GET") {
    allowMethods(req, res, ["GET"]);
    return;
  }

  const key = `${clientKey(req)}:image`;
  if (!checkRateLimit(imageRateLimits, key, imageRateLimitMax, rateLimitWindowMs)) {
    sendPlainText(req, res, 429, "Too many requests");
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const imageUrl = requestUrl.searchParams.get("url");

  if (!imageUrl) {
    sendPlainText(req, res, 400, "Missing image url");
    return;
  }

  let target;
  try {
    target = new URL(imageUrl);
  } catch {
    sendPlainText(req, res, 400, "Invalid image url");
    return;
  }

  if (target.protocol !== "https:" || !imageProxyAllowedHosts.has(target.hostname)) {
    sendPlainText(req, res, 400, "Unsupported image url");
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
      sendPlainText(req, res, response.status, "Image request failed");
      return;
    }

    const upstreamContentType = response.headers.get("content-type") || "application/octet-stream";
    const inferredContentType = imageContentTypeFromPath(target.pathname);
    const contentType = upstreamContentType.toLowerCase().startsWith("image/")
      ? upstreamContentType
      : inferredContentType;
    if (!contentType) {
      sendPlainText(req, res, 415, "Unsupported image response");
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
    sendPlainText(req, res, error.status || 502, error.status === 413 ? "Image is too large" : "Image proxy failed");
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

function validateHandle(handle) {
  return /^[A-Za-z0-9_]{2,20}$/.test(handle);
}

function getCachedMemoryPayload(cacheKey) {
  if (memoryCache.size > memoryCacheMaxEntries) {
    pruneExpiringStore(memoryCache, "expiresAt", Date.now(), memoryCacheMaxEntries);
  }

  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.payload;
  }

  return null;
}

function setCachedMemoryPayload(cacheKey, payload) {
  memoryCache.set(cacheKey, {
    expiresAt: Date.now() + memoryCacheTtlMs,
    payload,
  });
  if (memoryCache.size > memoryCacheMaxEntries) {
    pruneExpiringStore(memoryCache, "expiresAt", Date.now(), memoryCacheMaxEntries);
  }
}

async function fetchMemoryPayload(handle) {
  const cacheKey = handle.toLowerCase();
  const cached = getCachedMemoryPayload(cacheKey);
  if (cached) return cached;

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
      maxStreak: user.maxStreak,
      rating: user.rating,
      classLabel: getClassLabel(user),
    },
  };

  setCachedMemoryPayload(cacheKey, payload);
  return payload;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }

  return value;
}

function stableJson(value, space = 0) {
  return JSON.stringify(sortJsonValue(value), null, space);
}

function createBackupSnapshot(payload) {
  return {
    schema: "boj-memory-backup-v1",
    generatedAt: payload.fetchedAt,
    handle: payload.user?.handle ?? "",
    summary: {
      solvedCount: payload.stats?.solvedCount ?? 0,
      contributionCount: payload.stats?.contributionCount ?? 0,
      rivalCount: payload.stats?.rivalCount ?? 0,
      maxStreak: payload.stats?.maxStreak ?? 0,
      rating: payload.stats?.rating ?? 0,
      classLabel: payload.stats?.classLabel ?? "",
      solvedAcRank: payload.user?.rank ?? 0,
      bojRank: payload.bojStats?.find((item) => item.label === "등수")?.value ?? null,
      tier: payload.user?.tier ?? 0,
      overRating: payload.user?.overRating ?? 0,
    },
    payload,
  };
}

function formatBackupText(snapshot, { digest, signature }) {
  const compactJson = stableJson(snapshot);
  const prettyJson = stableJson(snapshot, 2);
  const summary = snapshot.summary;
  const lines = [
    "BOJ memory backup v1",
    `handle: ${snapshot.handle}`,
    `generated_at: ${snapshot.generatedAt}`,
    `snapshot_sha256: ${digest}`,
    `signature_algorithm: ${signature ? "HMAC-SHA256" : "unavailable"}`,
    `signature: ${signature || "unavailable"}`,
    "",
    "[summary]",
    `solved.ac rank: ${summary.solvedAcRank ?? 0}`,
    `boj rank: ${summary.bojRank ?? "unknown"}`,
    `solved count: ${summary.solvedCount ?? 0}`,
    `contribution count: ${summary.contributionCount ?? 0}`,
    `rival count: ${summary.rivalCount ?? 0}`,
    `max streak: ${summary.maxStreak ?? 0}`,
    `ac rating: ${summary.rating ?? 0}`,
    `over rating: ${summary.overRating ?? 0}`,
    `class: ${summary.classLabel || "CLASS 없음"}`,
    "",
    "[integrity]",
    "This backup text is generated on the server.",
    "The canonical snapshot JSON below is the source of truth for hash/signature checks.",
    "If the canonical snapshot block is changed, integrity validation should fail.",
    "",
    "[canonical_snapshot_json]",
    prettyJson,
    "",
    "[canonical_snapshot_compact]",
    compactJson,
    "",
  ];

  return lines.join("\n");
}

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertValid(condition, message, status = 400) {
  if (!condition) throw createHttpError(message, status);
}

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function requireObject(value, message) {
  assertValid(value && typeof value === "object" && !Array.isArray(value), message);
  return value;
}

function validatePlainText(value, maxLength, message, { allowEmpty = true } = {}) {
  assertValid(typeof value === "string", message);
  assertValid(value.length <= maxLength, message);
  assertValid(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), message);
  if (!allowEmpty) {
    assertValid(value.trim().length > 0, message);
  }
  return value;
}

function validateInteger(value, min, max, message) {
  assertValid(Number.isInteger(value), message);
  assertValid(value >= min && value <= max, message);
  return value;
}

function validateOptionalStyleClass(value) {
  assertValid(allowedBackupStyleClasses.has(value ?? null), "유효하지 않은 결과 스타일입니다.");
  return value ?? null;
}

function validateImageUrl(url) {
  if (!url) return null;
  assertValid(typeof url === "string" && url.length <= 512, "유효하지 않은 이미지 주소입니다.");
  let target;
  try {
    target = new URL(url);
  } catch {
    throw createHttpError("유효하지 않은 이미지 주소입니다.");
  }

  assertValid(target.protocol === "https:", "유효하지 않은 이미지 주소입니다.");
  assertValid(imageProxyAllowedHosts.has(target.hostname), "허용되지 않은 이미지 주소입니다.");
  return target.toString();
}

function normalizeImportedUser(rawUser) {
  const user = requireObject(rawUser, "유저 정보 형식이 올바르지 않습니다.");
  const handle = validatePlainText(user.handle, 20, "유저명이 올바르지 않습니다.", { allowEmpty: false });
  assertValid(validateHandle(handle), "유저명이 올바르지 않습니다.");

  const classValue = user.class == null ? 0 : validateInteger(Number(user.class), 0, 10, "class 정보가 올바르지 않습니다.");
  const classDecoration = user.classDecoration ?? "none";
  assertValid(allowedClassDecorations.has(classDecoration), "class 장식 정보가 올바르지 않습니다.");

  return {
    handle,
    bio: validatePlainText(user.bio ?? "", 280, "상태메시지 형식이 올바르지 않습니다."),
    profileImageUrl: validateImageUrl(user.profileImageUrl),
    solvedCount: validateInteger(Number(user.solvedCount ?? 0), 0, 1000000, "푼 문제 수가 올바르지 않습니다."),
    voteCount: validateInteger(Number(user.voteCount ?? 0), 0, 1000000, "기여한 문제 수가 올바르지 않습니다."),
    class: classValue,
    classDecoration,
    rivalCount: validateInteger(Number(user.rivalCount ?? 0), 0, 1000000, "라이벌 수가 올바르지 않습니다."),
    reverseRivalCount: validateInteger(Number(user.reverseRivalCount ?? 0), 0, 1000000, "reverse rival 수가 올바르지 않습니다."),
    tier: validateInteger(Number(user.tier ?? 0), 0, 31, "티어 정보가 올바르지 않습니다."),
    rating: validateInteger(Number(user.rating ?? 0), 0, 1000000, "레이팅이 올바르지 않습니다."),
    ratingByProblemsSum: validateInteger(Number(user.ratingByProblemsSum ?? 0), 0, 1000000, "top 100 rating이 올바르지 않습니다."),
    ratingByClass: validateInteger(Number(user.ratingByClass ?? 0), 0, 1000000, "class bonus가 올바르지 않습니다."),
    ratingBySolvedCount: validateInteger(Number(user.ratingBySolvedCount ?? 0), 0, 1000000, "solve bonus가 올바르지 않습니다."),
    ratingByVoteCount: validateInteger(Number(user.ratingByVoteCount ?? 0), 0, 1000000, "contribution bonus가 올바르지 않습니다."),
    rank: validateInteger(Number(user.rank ?? 0), 0, 100000000, "랭킹 정보가 올바르지 않습니다."),
    maxStreak: validateInteger(Number(user.maxStreak ?? 0), 0, 100000, "스트릭 정보가 올바르지 않습니다."),
    backgroundId: validatePlainText(user.backgroundId ?? "", 120, "배경 ID 형식이 올바르지 않습니다."),
    badgeId: validatePlainText(user.badgeId ?? "", 120, "뱃지 ID 형식이 올바르지 않습니다."),
    overRating: validateInteger(Number(user.overRating ?? 0), 0, 1000000000, "over rating이 올바르지 않습니다."),
  };
}

function normalizeImportedMediaContainer(rawValue, type) {
  if (!rawValue) return null;
  const nested = rawValue?.[type] ?? rawValue;
  const media = requireObject(nested, `${type} 정보 형식이 올바르지 않습니다.`);
  const normalized = type === "background"
    ? {
      displayName: validatePlainText(media.displayName ?? "", 120, "배경 이름 형식이 올바르지 않습니다."),
      backgroundImageUrl: validateImageUrl(media.backgroundImageUrl),
      fallbackBackgroundImageUrl: validateImageUrl(media.fallbackBackgroundImageUrl),
    }
    : {
      displayName: validatePlainText(media.displayName ?? "", 120, "뱃지 이름 형식이 올바르지 않습니다."),
      badgeImageUrl: validateImageUrl(media.badgeImageUrl),
    };

  return { [type]: normalized };
}

function normalizeImportedClassStats(rawValue) {
  assertValid(Array.isArray(rawValue), "클래스 통계 형식이 올바르지 않습니다.");
  assertValid(rawValue.length <= 32, "클래스 통계가 너무 많습니다.");
  return rawValue.map((entry) => {
    const item = requireObject(entry, "클래스 통계 항목 형식이 올바르지 않습니다.");
    const decoration = item.decoration ?? null;
    assertValid(allowedClassDecorations.has(decoration), "클래스 장식 값이 올바르지 않습니다.");
    return {
      class: validateInteger(Number(item.class ?? 0), 1, 10, "클래스 번호가 올바르지 않습니다."),
      total: validateInteger(Number(item.total ?? 0), 0, 100000, "클래스 total 값이 올바르지 않습니다."),
      totalSolved: validateInteger(Number(item.totalSolved ?? 0), 0, 100000, "클래스 solved 값이 올바르지 않습니다."),
      essentials: validateInteger(Number(item.essentials ?? 0), 0, 100000, "클래스 essential 값이 올바르지 않습니다."),
      essentialSolved: validateInteger(Number(item.essentialSolved ?? 0), 0, 100000, "클래스 essential solved 값이 올바르지 않습니다."),
      decoration,
    };
  });
}

function normalizeImportedTopProblems(rawValue) {
  assertValid(Array.isArray(rawValue), "top 100 정보 형식이 올바르지 않습니다.");
  assertValid(rawValue.length <= 100, "top 100 정보가 너무 많습니다.");
  return rawValue.map((entry) => {
    const item = requireObject(entry, "top problem 항목 형식이 올바르지 않습니다.");
    return {
      problemId: validateInteger(Number(item.problemId ?? 0), 1, 10000000, "문제 번호가 올바르지 않습니다."),
      titleKo: validatePlainText(item.titleKo ?? "", 200, "문제 제목이 올바르지 않습니다."),
      level: validateInteger(Number(item.level ?? 0), 0, 31, "문제 난이도가 올바르지 않습니다."),
    };
  });
}

function normalizeImportedBojStats(rawValue) {
  assertValid(Array.isArray(rawValue), "BOJ 통계 형식이 올바르지 않습니다.");
  assertValid(rawValue.length <= 128, "BOJ 통계가 너무 많습니다.");
  return rawValue.map((entry) => {
    const item = requireObject(entry, "BOJ 통계 항목 형식이 올바르지 않습니다.");
    return {
      label: validatePlainText(item.label ?? "", 60, "BOJ 통계 라벨이 올바르지 않습니다.", { allowEmpty: false }),
      value: validateInteger(Number(item.value ?? 0), 0, 1000000000, "BOJ 통계 값이 올바르지 않습니다."),
      styleClass: validateOptionalStyleClass(item.styleClass ?? null),
    };
  });
}

function normalizeImportedLanguageStats(rawValue) {
  assertValid(Array.isArray(rawValue), "언어 통계 형식이 올바르지 않습니다.");
  assertValid(rawValue.length <= 64, "언어 통계가 너무 많습니다.");
  return rawValue.map((entry) => {
    const item = requireObject(entry, "언어 통계 항목 형식이 올바르지 않습니다.");
    const statuses = Array.isArray(item.statuses) ? item.statuses : [];
    assertValid(statuses.length <= 16, "언어 상태 정보가 너무 많습니다.");

    return {
      language: validatePlainText(item.language ?? "", 80, "언어명이 올바르지 않습니다.", { allowEmpty: false }),
      statuses: statuses.map((status) => {
        const normalized = requireObject(status, "언어 상태 항목 형식이 올바르지 않습니다.");
        return {
          label: validatePlainText(normalized.label ?? "", 40, "언어 상태 라벨이 올바르지 않습니다.", { allowEmpty: false }),
          value: validateInteger(Number(normalized.value ?? 0), 0, 1000000000, "언어 상태 값이 올바르지 않습니다."),
          text: validatePlainText(normalized.text ?? "", 40, "언어 상태 텍스트가 올바르지 않습니다."),
          styleClass: validateOptionalStyleClass(normalized.styleClass ?? null),
        };
      }),
      solvedProblems: validateInteger(Number(item.solvedProblems ?? 0), 0, 1000000000, "언어 solved 값이 올바르지 않습니다."),
      submissions: validateInteger(Number(item.submissions ?? 0), 0, 1000000000, "언어 제출 값이 올바르지 않습니다."),
      acceptedRate: validatePlainText(item.acceptedRate ?? "0.000%", 24, "언어 정답 비율 형식이 올바르지 않습니다."),
    };
  });
}

function normalizeImportedPayload(rawPayload, generatedAt) {
  const payload = requireObject(rawPayload, "백업 payload 형식이 올바르지 않습니다.");
  const user = normalizeImportedUser(payload.user);
  const classStats = normalizeImportedClassStats(payload.classStats ?? []);
  const topProblems = normalizeImportedTopProblems(payload.topProblems ?? []);
  const bojStats = normalizeImportedBojStats(payload.bojStats ?? []);
  const languageStats = normalizeImportedLanguageStats(payload.languageStats ?? []);
  const background = normalizeImportedMediaContainer(payload.background, "background");
  const badge = normalizeImportedMediaContainer(payload.badge, "badge");

  return {
    fetchedAt: generatedAt,
    user,
    badge,
    background,
    classStats,
    topProblems,
    bojStats,
    languageStats,
    stats: {
      solvedCount: user.solvedCount,
      contributionCount: user.voteCount,
      rivalCount: user.rivalCount,
      maxStreak: user.maxStreak,
      rating: user.rating,
      classLabel: getClassLabel(user),
    },
  };
}

function parseBackupHeader(text) {
  const lines = text.split("\n");
  const fields = new Map();

  for (const line of lines) {
    const dividerIndex = line.indexOf(": ");
    if (dividerIndex <= 0) continue;
    const key = line.slice(0, dividerIndex).trim();
    const value = line.slice(dividerIndex + 2).trim();
    fields.set(key, value);
  }

  return {
    handle: fields.get("handle") ?? "",
    generatedAt: fields.get("generated_at") ?? "",
    digest: fields.get("snapshot_sha256") ?? "",
    signatureAlgorithm: fields.get("signature_algorithm") ?? "",
    signature: fields.get("signature") ?? "",
  };
}

function parseAndVerifyBackupText(text) {
  const normalizedText = String(text ?? "").replace(/\r\n?/g, "\n");
  assertValid(normalizedText.startsWith("BOJ memory backup v1\n"), "백업 TXT 형식이 올바르지 않습니다.");

  const compactMarker = "\n[canonical_snapshot_compact]\n";
  const compactMarkerIndex = normalizedText.indexOf(compactMarker);
  assertValid(compactMarkerIndex >= 0, "백업 TXT의 스냅샷 영역을 찾을 수 없습니다.");

  const header = parseBackupHeader(normalizedText.slice(0, compactMarkerIndex));
  assertValid(validateHandle(header.handle), "백업 TXT의 유저명이 올바르지 않습니다.");
  assertValid(isValidDateString(header.generatedAt), "백업 TXT의 생성 시간이 올바르지 않습니다.");
  assertValid(backupSignaturePattern.test(header.digest), "백업 TXT의 해시가 올바르지 않습니다.");
  assertValid(["HMAC-SHA256", "unavailable"].includes(header.signatureAlgorithm), "백업 TXT의 서명 알고리즘이 올바르지 않습니다.");
  assertValid(
    header.signature === "unavailable" || backupSignaturePattern.test(header.signature),
    "백업 TXT의 서명 형식이 올바르지 않습니다.",
  );

  const compactJson = normalizedText.slice(compactMarkerIndex + compactMarker.length).trim();
  assertValid(compactJson.length > 0, "백업 TXT의 JSON 영역이 비어 있습니다.");

  let snapshot;
  try {
    snapshot = JSON.parse(compactJson);
  } catch {
    throw createHttpError("백업 TXT의 JSON 형식이 올바르지 않습니다.");
  }

  const snapshotObject = requireObject(snapshot, "백업 스냅샷 형식이 올바르지 않습니다.");
  assertValid(snapshotObject.schema === "boj-memory-backup-v1", "지원하지 않는 백업 버전입니다.");
  assertValid(snapshotObject.handle === header.handle, "백업 TXT의 handle 정보가 일치하지 않습니다.");
  assertValid(snapshotObject.generatedAt === header.generatedAt, "백업 TXT의 생성 시간이 일치하지 않습니다.");
  assertValid(isValidDateString(snapshotObject.generatedAt), "백업 스냅샷 생성 시간이 올바르지 않습니다.");

  const canonicalCompact = stableJson(snapshotObject);
  const digest = createHash("sha256").update(canonicalCompact).digest("hex");
  assertValid(digest === header.digest, "백업 TXT의 무결성 검증에 실패했습니다.");

  const signatureAvailable = header.signatureAlgorithm === "HMAC-SHA256" && header.signature !== "unavailable";
  let signatureVerified = false;
  if (signatureAvailable && backupSignatureSecret) {
    const expectedSignature = createHmac("sha256", backupSignatureSecret).update(canonicalCompact).digest("hex");
    assertValid(expectedSignature === header.signature, "백업 TXT의 서버 서명 검증에 실패했습니다.");
    signatureVerified = true;
  }

  const payload = normalizeImportedPayload(snapshotObject.payload, snapshotObject.generatedAt);
  assertValid(payload.user.handle === snapshotObject.handle, "백업 TXT의 유저 정보가 일치하지 않습니다.");

  return {
    payload,
    verification: {
      hashVerified: true,
      signatureVerified,
      signatureProvided: signatureAvailable,
      serverSignatureConfigured: Boolean(backupSignatureSecret),
    },
  };
}

async function handleMemoryRequest(req, res) {
  if (!validateFrontendRequest(req, res)) return;
  if (req.method !== "GET") {
    allowMethods(req, res, ["GET"]);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const handle = url.searchParams.get("handle")?.trim();

  if (!handle) {
    sendJson(req, res, 400, { message: "유저명을 입력해주세요." });
    return;
  }

  if (!validateHandle(handle)) {
    sendJson(req, res, 400, { message: "BOJ 유저명 형식이 올바르지 않습니다." });
    return;
  }

  const key = `${clientKey(req)}:memory`;
  if (!checkRateLimit(memoryRateLimits, key, memoryRateLimitMax, rateLimitWindowMs)) {
    sendJson(req, res, 429, { message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  try {
    const payload = await fetchMemoryPayload(handle);
    sendJson(req, res, 200, payload);
  } catch (error) {
    sendJson(req, res, error.status || 500, {
      message: error.message || "잠시 후 다시 시도해주세요.",
    });
  }
}

async function handleBackupRequest(req, res) {
  if (!validateFrontendRequest(req, res)) return;
  if (req.method !== "GET") {
    allowMethods(req, res, ["GET"]);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const handle = url.searchParams.get("handle")?.trim();

  if (!handle) {
    sendPlainText(req, res, 400, "Missing handle");
    return;
  }

  if (!validateHandle(handle)) {
    sendPlainText(req, res, 400, "Invalid handle");
    return;
  }

  const key = `${clientKey(req)}:backup`;
  if (!checkRateLimit(memoryRateLimits, key, memoryRateLimitMax, rateLimitWindowMs)) {
    sendPlainText(req, res, 429, "Too many requests");
    return;
  }

  try {
    const payload = await fetchMemoryPayload(handle);
    const snapshot = createBackupSnapshot(payload);
    const compactJson = stableJson(snapshot);
    const digest = createHash("sha256").update(compactJson).digest("hex");
    const signature = backupSignatureSecret
      ? createHmac("sha256", backupSignatureSecret).update(compactJson).digest("hex")
      : "";
    const text = formatBackupText(snapshot, { digest, signature });
    const safeFilename = `BOJ memory - ${handle}.txt`;

    res.writeHead(200, corsHeaders(req, securityHeaders({
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
      "cache-control": "no-store",
    })));
    res.end(text);
  } catch (error) {
    sendPlainText(req, res, error.status || 500, error.message || "Failed to create backup");
  }
}

async function handleBackupImportRequest(req, res) {
  if (!validateFrontendRequest(req, res)) return;
  if (req.method !== "POST") {
    allowMethods(req, res, ["POST"]);
    return;
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType && !contentType.startsWith("text/plain")) {
    sendJson(req, res, 415, { message: "TXT 형식의 요청만 불러올 수 있습니다." });
    return;
  }

  const key = `${clientKey(req)}:backup-import`;
  if (!checkRateLimit(memoryRateLimits, key, backupImportRateLimitMax, rateLimitWindowMs)) {
    sendJson(req, res, 429, { message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  try {
    const backupText = await readRequestTextWithLimit(req, backupTextMaxBytes);
    const result = parseAndVerifyBackupText(backupText);
    sendJson(req, res, 200, result);
  } catch (error) {
    sendJson(req, res, error.status || 400, {
      message: error.message || "백업 TXT를 불러오지 못했습니다.",
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
    if (extname(filePath)) {
      res.writeHead(404, securityHeaders({
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      }));
      res.end("Not found");
      return;
    }

    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, appSecurityHeaders({
      "content-type": contentTypes[".html"],
      "cache-control": "no-store",
    }));
    res.end(fallback);
  }
}

const server = createServer((req, res) => {
  const pathname = pathnameFromRequest(req);

  if (req.method === "OPTIONS") {
    handleApiOptions(req, res);
    return;
  }

  if (pathname === "/api/memory") {
    handleMemoryRequest(req, res);
    return;
  }

  if (pathname === "/api/image") {
    proxyImageRequest(req, res);
    return;
  }

  if (pathname === "/api/backup/import") {
    handleBackupImportRequest(req, res);
    return;
  }

  if (pathname === "/api/backup") {
    handleBackupRequest(req, res);
    return;
  }

  serveStatic(req, res);
});

export {
  corsHeaders,
  handleApiOptions,
  handleBackupImportRequest,
  handleBackupRequest,
  handleMemoryRequest,
  proxyImageRequest,
  securityHeaders,
  validateFrontendRequest,
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  server.listen(port, () => {
    console.log(`Goodbye BOJ is running at http://localhost:${port}`);
  });
}
