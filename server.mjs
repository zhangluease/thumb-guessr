import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const distRoot = resolve(projectRoot, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
let dbPool;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

function applyHeaders(response, filePath) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  let ossOrigin = "";
  try {
    ossOrigin = process.env.OSS_PUBLIC_BASE_URL ? new URL(process.env.OSS_PUBLIC_BASE_URL).origin : "";
  } catch {
    ossOrigin = "";
  }
  const imageSources = ["'self'", "data:", "https://i.ytimg.com", "https://yt3.ggpht.com", ossOrigin].filter(Boolean).join(" ");
  response.setHeader("Content-Security-Policy", `default-src 'self'; img-src ${imageSources}; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
  response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function parseYouTubeVideoId(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

  let url;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
  }

  if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) return null;
  const queryId = url.searchParams.get("v");
  if (/^[A-Za-z0-9_-]{11}$/.test(queryId || "")) return queryId;

  const pathParts = url.pathname.split("/").filter(Boolean);
  const pathId = ["shorts", "embed", "live"].includes(pathParts[0]) ? pathParts[1] : null;
  return /^[A-Za-z0-9_-]{11}$/.test(pathId || "") ? pathId : null;
}

function parseYouTubeIds(url) {
  const values = [
    ...url.searchParams.getAll("id"),
    ...(url.searchParams.get("ids") || "").split(/[\s,]+/)
  ].map((value) => value.trim()).filter(Boolean);
  return [...new Set(values)];
}

function getDbPool() {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME || "thumb_guessr",
      user: process.env.DB_USER || "thumb_guessr",
      password: process.env.DB_PASSWORD || "",
      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 0,
      charset: "utf8mb4"
    });
  }
  return dbPool;
}

function formatQuestionRow(row) {
  return {
    id: row.id,
    title: row.title,
    channelTitle: row.channelTitle,
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    thumbnail: row.thumbnail,
    viewCount: String(row.viewCount)
  };
}

async function handleYouTubeVideos(url, response) {
  const inputs = parseYouTubeIds(url);
  if (!inputs.length || inputs.length > 10) {
    sendJson(response, 400, { error: "请提供 1-10 个 YouTube 视频链接或视频 ID" });
    return;
  }

  const parsedIds = inputs.map(parseYouTubeVideoId);
  const invalid = inputs.filter((_, index) => !parsedIds[index]);
  if (invalid.length) {
    sendJson(response, 400, { error: "存在无法识别的 YouTube 视频链接或 ID", invalid });
    return;
  }

  const ids = [...new Set(parsedIds)];

  let rows;
  try {
    [rows] = await getDbPool().query(
      `SELECT platform_video_id AS id,
              title,
              channel_title AS channelTitle,
              published_at AS publishedAt,
              thumbnail_url AS thumbnail,
              view_count AS viewCount
         FROM videos
        WHERE platform = 'youtube'
          AND enabled = 1
          AND platform_video_id IN (?)`,
      [ids]
    );
  } catch (error) {
    console.error(`YouTube 数据库查询失败: ${error.message}`);
    sendJson(response, 503, { error: "数据库暂不可用，请先确认 ECS 的 MySQL 配置" });
    return;
  }

  const videos = new Map(rows.map((row) => [row.id, formatQuestionRow(row)]));

  sendJson(response, 200, {
    requested: ids.length,
    found: videos.size,
    videos: ids.map((id) => videos.get(id) || { id, unavailable: true })
  });
}

async function handleQuizQuestions(response, requestUrl) {
  const excludedIds = [...new Set(String(requestUrl?.searchParams.get("exclude") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_-]{11}$/.test(value)))].slice(0, 200);
  const exclusionClause = excludedIds.length ? "AND platform_video_id NOT IN (?)" : "";
  let rows;
  try {
    [rows] = await getDbPool().query(
      `SELECT platform_video_id AS id,
              title,
              channel_title AS channelTitle,
              published_at AS publishedAt,
              thumbnail_url AS thumbnail,
              view_count AS viewCount
         FROM videos
        WHERE platform = 'youtube'
          AND enabled = 1
          ${exclusionClause}
        ORDER BY RAND()
        LIMIT 50`,
      excludedIds.length ? [excludedIds] : []
    );
  } catch (error) {
    console.error(`题库数据库查询失败: ${error.message}`);
    sendJson(response, 503, { error: "数据库暂不可用，请先确认 ECS 的 MySQL 配置" });
    return;
  }

  sendJson(response, 200, {
    source: "mysql",
    questions: rows.map(formatQuestionRow)
  });
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
  const filePath = resolve(distRoot, relativePath);

  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  return join(distRoot, "index.html");
}

if (!existsSync(join(distRoot, "index.html"))) {
  console.error("未找到 dist/index.html，请先运行 npm run build");
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (requestUrl.pathname === "/api/youtube/videos") {
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end();
      return;
    }
    handleYouTubeVideos(requestUrl, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "YouTube 数据处理失败" });
    });
    return;
  }

  if (requestUrl.pathname === "/api/quiz") {
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end();
      return;
    }
    handleQuizQuestions(response, requestUrl).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "题库处理失败" });
    });
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(request.url || "/");
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const fileSize = statSync(filePath).size;
  applyHeaders(response, filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": fileSize
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`thumb-guessr 已启动：http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
