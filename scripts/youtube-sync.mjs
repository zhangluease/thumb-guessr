import { existsSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";

function loadLocalEnv(filePath = ".env.local") {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

function parseVideoId(value) {
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

function parseDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || "");
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`缺少 ${name}，请写入 .env.local 或设置环境变量`);
  return value;
}

const rawInputs = process.argv.slice(2).flatMap((value) => value.split(/[\s,]+/)).filter(Boolean);
if (!rawInputs.length || rawInputs.length > 50) {
  console.error("用法：npm run youtube:sync -- <YouTube 链接或视频 ID> [第二个链接或 ID]");
  process.exit(2);
}

const parsedIds = rawInputs.map(parseVideoId);
if (parsedIds.some((id) => !id)) {
  console.error("存在无法识别的 YouTube 视频链接或 ID");
  process.exit(2);
}
const ids = [...new Set(parsedIds)];

const apiKey = required("YOUTUBE_API_KEY");
const db = await mysql.createConnection({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  charset: "utf8mb4"
});

try {
  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  apiUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  apiUrl.searchParams.set("id", ids.join(","));
  apiUrl.searchParams.set("key", apiKey);

  const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason ? ` (${payload.error.errors[0].reason})` : "";
    throw new Error(`${payload?.error?.message || "YouTube Data API 请求失败"}${reason}`);
  }

  const items = payload.items || [];
  await db.beginTransaction();
  const foundIds = new Set();
  for (const item of items) {
    const snippet = item.snippet || {};
    const statistics = item.statistics || {};
    const thumbnail = snippet.thumbnails?.maxres?.url
      || snippet.thumbnails?.high?.url
      || snippet.thumbnails?.medium?.url
      || snippet.thumbnails?.default?.url;
    if (!thumbnail || !snippet.title || statistics.viewCount === undefined) continue;

    foundIds.add(item.id);
    const [result] = await db.execute(
      `INSERT INTO videos
        (platform, platform_video_id, channel_id, channel_title, title, thumbnail_url,
         duration_seconds, published_at, view_count, statistics_fetched_at, enabled)
       VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), 1)
       ON DUPLICATE KEY UPDATE
         channel_id = VALUES(channel_id),
         channel_title = VALUES(channel_title),
         title = VALUES(title),
         thumbnail_url = VALUES(thumbnail_url),
         duration_seconds = VALUES(duration_seconds),
         published_at = VALUES(published_at),
         view_count = VALUES(view_count),
         statistics_fetched_at = VALUES(statistics_fetched_at),
         enabled = 1`,
      [
        item.id,
        snippet.channelId || null,
        snippet.channelTitle || null,
        snippet.title,
        thumbnail,
        parseDuration(item.contentDetails?.duration),
        snippet.publishedAt ? new Date(snippet.publishedAt) : null,
        String(statistics.viewCount)
      ]
    );

    const videoId = result.insertId || (await db.query(
      "SELECT id FROM videos WHERE platform = 'youtube' AND platform_video_id = ?",
      [item.id]
    ))[0][0].id;
    await db.execute(
      `INSERT INTO video_stat_snapshots (video_id, view_count, like_count, comment_count)
       VALUES (?, ?, ?, ?)`,
      [videoId, String(statistics.viewCount), statistics.likeCount || null, statistics.commentCount || null]
    );
  }
  await db.commit();

  console.log(`已同步 ${foundIds.size}/${ids.length} 条视频到数据库`);
  for (const id of ids) console.log(`${foundIds.has(id) ? "OK" : "MISS"}\t${id}`);
} catch (error) {
  await db.rollback();
  console.error(`同步失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
