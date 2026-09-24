import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const distRoot = resolve(projectRoot, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const numberFromEnv = (name, fallback, minimum, maximum) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
};
const onlineActiveMinutes = numberFromEnv("ONLINE_ACTIVE_MINUTES", 5, 1, 60);
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

function sendMethodNotAllowed(response, allow) {
  response.writeHead(405, { Allow: allow });
  response.end("Method Not Allowed");
}

function readJsonBody(request, limit = 2048) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error("请求内容过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 格式无效"));
      }
    });
    request.on("error", reject);
  });
}

function isVisitorId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeTokenEqual(received, expected) {
  const receivedBuffer = Buffer.from(received || "");
  const expectedBuffer = Buffer.from(expected || "");
  return receivedBuffer.length === expectedBuffer.length
    && receivedBuffer.length > 0
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function authorizeStats(request, response) {
  const expected = String(process.env.STATS_ADMIN_TOKEN || "").trim();
  if (!expected) {
    sendJson(response, 503, { error: "统计查询尚未配置 STATS_ADMIN_TOKEN" });
    return false;
  }
  const authorization = String(request.headers.authorization || "");
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!safeTokenEqual(received, expected)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    sendJson(response, 401, { error: "统计查询认证失败" });
    return false;
  }
  return true;
}

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseStatsDate(value, endOfRange) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input} ${endOfRange ? "23:59:59.999" : "00:00:00.000"}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(input);
  return match ? `${match[1]} ${match[2]}:${match[3] || "00"}` : null;
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

async function getPresenceSnapshot() {
  const [rows] = await getDbPool().query(
    `SELECT COUNT(DISTINCT visitor_id) AS activeUsers
       FROM visitor_activity_5m
      WHERE last_seen_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${onlineActiveMinutes} MINUTE)`
  );
  const activeUsers = Number(rows[0]?.activeUsers || 0);
  return {
    activeUsers,
    displayCount: activeUsers,
    activeWindowSeconds: onlineActiveMinutes * 60
  };
}

async function handlePresenceHeartbeat(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  const visitorId = String(payload.visitorId || "").trim().toLowerCase();
  if (!isVisitorId(visitorId)) {
    sendJson(response, 400, { error: "visitorId 格式无效" });
    return;
  }

  try {
    await getDbPool().execute(
      `INSERT INTO visitor_activity_5m
         (visitor_id, bucket_start, first_seen_at, last_seen_at, activity_count)
       VALUES (
         ?,
         FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) / 300) * 300),
         CURRENT_TIMESTAMP(3),
         CURRENT_TIMESTAMP(3),
         1
       )
       ON DUPLICATE KEY UPDATE
         last_seen_at = CURRENT_TIMESTAMP(3),
         activity_count = activity_count + 1`,
      [visitorId]
    );
    sendJson(response, 200, await getPresenceSnapshot());
  } catch (error) {
    console.error(`活跃用户写入失败: ${error.message}`);
    sendJson(response, 503, { error: "活跃用户统计暂不可用" });
  }
}

async function handlePresence(response) {
  try {
    sendJson(response, 200, await getPresenceSnapshot());
  } catch (error) {
    console.error(`在线人数查询失败: ${error.message}`);
    sendJson(response, 503, { error: "在线人数暂不可用", displayCount: 0 });
  }
}

async function handleUvStats(request, requestUrl, response) {
  if (!authorizeStats(request, response)) return;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = requestUrl.searchParams.has("from")
    ? parseStatsDate(requestUrl.searchParams.get("from"), false)
    : formatLocalDate(sevenDaysAgo);
  const to = requestUrl.searchParams.has("to")
    ? parseStatsDate(requestUrl.searchParams.get("to"), true)
    : formatLocalDate(now);
  const bucket = requestUrl.searchParams.get("bucket") || "day";
  if (!from || !to || from > to || !["hour", "day"].includes(bucket)) {
    sendJson(response, 400, { error: "请使用有效的 from、to 和 bucket=hour|day 参数" });
    return;
  }

  const periodExpression = bucket === "hour"
    ? "DATE_FORMAT(bucket_start, '%Y-%m-%d %H:00:00')"
    : "DATE_FORMAT(bucket_start, '%Y-%m-%d')";
  try {
    const [[totalRows], [seriesRows]] = await Promise.all([
      getDbPool().query(
        `SELECT COUNT(DISTINCT visitor_id) AS uv
           FROM visitor_activity_5m
          WHERE first_seen_at <= ? AND last_seen_at >= ?`,
        [to, from]
      ),
      getDbPool().query(
        `SELECT ${periodExpression} AS period,
                COUNT(DISTINCT visitor_id) AS uv
           FROM visitor_activity_5m
          WHERE first_seen_at <= ? AND last_seen_at >= ?
          GROUP BY period
          ORDER BY period`,
        [to, from]
      )
    ]);
    sendJson(response, 200, {
      from,
      to,
      bucket,
      timezone: "Asia/Shanghai",
      totalUv: Number(totalRows[0]?.uv || 0),
      series: seriesRows.map((row) => ({ period: row.period, uv: Number(row.uv) }))
    });
  } catch (error) {
    console.error(`UV 统计查询失败: ${error.message}`);
    sendJson(response, 503, { error: "UV 统计暂不可用" });
  }
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
  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (requestUrl.pathname === "/api/presence/heartbeat") {
    if (request.method !== "POST") {
      sendMethodNotAllowed(response, "POST");
      return;
    }
    handlePresenceHeartbeat(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "活跃用户处理失败" });
    });
    return;
  }

  if (requestUrl.pathname === "/api/presence") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendMethodNotAllowed(response, "GET, HEAD");
      return;
    }
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end();
      return;
    }
    handlePresence(response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "在线人数处理失败" });
    });
    return;
  }

  if (requestUrl.pathname === "/api/stats/uv") {
    if (request.method !== "GET") {
      sendMethodNotAllowed(response, "GET");
      return;
    }
    handleUvStats(request, requestUrl, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "UV 统计处理失败" });
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendMethodNotAllowed(response, "GET, HEAD");
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
