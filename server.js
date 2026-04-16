import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const solvedBaseUrl = "https://solved.ac/api/v3";
const bojBaseUrl = "https://www.acmicpc.net";
const readerBaseUrl = "https://r.jina.ai/http://r.jina.ai/http://";
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function proxyImageRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const imageUrl = requestUrl.searchParams.get("url");

  if (!imageUrl) {
    res.writeHead(400);
    res.end("Missing image url");
    return;
  }

  let target;
  try {
    target = new URL(imageUrl);
  } catch {
    res.writeHead(400);
    res.end("Invalid image url");
    return;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    res.writeHead(400);
    res.end("Unsupported image url");
    return;
  }

  try {
    const response = await fetch(target, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "goodbye-boj/0.1",
      },
    });

    if (!response.ok) {
      res.writeHead(response.status);
      res.end("Image request failed");
      return;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(502);
    res.end("Image proxy failed");
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
  const response = await fetch(url, {
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

  return response.json();
}

async function fetchSolvedThroughReader(url) {
  const response = await fetch(`${readerBaseUrl}${url}`, {
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

  const text = await response.text();
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

function parseBojStats(html) {
  const table = html.match(/<table[^>]*id=["']statics["'][\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];

  const stats = [];
  const rowPattern = /<tr>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;

  while ((match = rowPattern.exec(table))) {
    const labelHtml = match[1];
    const label = stripHtml(match[1]);
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
  const response = await fetch(`${bojBaseUrl}/user/${encodeURIComponent(handle)}`, {
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

  return parseBojStats(await response.text());
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
  const response = await fetch(`${bojBaseUrl}/user/language/${encodeURIComponent(handle)}`, {
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

  return parseBojLanguageStats(await response.text());
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handle = url.searchParams.get("handle")?.trim();

  if (!handle) {
    sendJson(res, 400, { message: "유저명을 입력해주세요." });
    return;
  }

  if (!/^[A-Za-z0-9_]{2,20}$/.test(handle)) {
    sendJson(res, 400, { message: "BOJ 유저명 형식이 올바르지 않습니다." });
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

    sendJson(res, 200, {
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
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      message: error.message || "잠시 후 다시 시도해주세요.",
    });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = safePath === "/" ? join(publicDir, "index.html") : join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": contentTypes[".html"],
      "cache-control": "no-store",
    });
    res.end(fallback);
  }
}

const server = createServer((req, res) => {
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

server.listen(port, () => {
  console.log(`Goodbye BOJ is running at http://localhost:${port}`);
});
