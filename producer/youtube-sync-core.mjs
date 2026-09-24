import mysql from "mysql2/promise";
import { ProxyAgent } from "undici";

export class SyncInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncInputError";
  }
}

export function parseVideoId(value) {
  const rawInput = String(value || "").trim();
  const markdownLink = /^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/.exec(rawInput);
  const input = (markdownLink ? markdownLink[1] : rawInput).trim();
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

function required(config, name) {
  const value = String(config[name] || "").trim();
  if (!value) throw new Error(`缺少 ${name}，请写入 .env.local 或设置环境变量`);
  return value;
}

export async function syncVideos(inputs, config = process.env) {
  const values = inputs.map((value) => String(value || "").trim()).filter(Boolean);
  if (!values.length || values.length > 50) {
    throw new SyncInputError("请提供 1-50 个 YouTube 视频链接或视频 ID");
  }

  const parsedIds = values.map(parseVideoId);
  if (parsedIds.some((id) => !id)) {
    throw new SyncInputError("存在无法识别的 YouTube 视频链接或 ID");
  }
  const ids = [...new Set(parsedIds)];
  const apiKey = required(config, "YOUTUBE_API_KEY");

  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  apiUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  apiUrl.searchParams.set("id", ids.join(","));
  apiUrl.searchParams.set("key", apiKey);

  let response;
  const dispatcher = config.YOUTUBE_PROXY_URL ? new ProxyAgent(String(config.YOUTUBE_PROXY_URL).trim()) : undefined;
  try {
    response = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || error.message;
    throw new Error(`无法连接 YouTube Data API（${cause}）。请确认本机网络/VPN 可以访问 www.googleapis.com；如果本机代理端口是 7890，可在 .env.local 设置 YOUTUBE_PROXY_URL=http://127.0.0.1:7890；命令参数请使用纯 URL 或视频 ID。`);
  }
  const payload = await response.json().catch(() => ({}));
  if (dispatcher) await dispatcher.close();
  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason ? ` (${payload.error.errors[0].reason})` : "";
    throw new Error(`${payload?.error?.message || "YouTube Data API 请求失败"}${reason}`);
  }

  const db = await mysql.createConnection({
    host: required(config, "DB_HOST"),
    port: Number(config.DB_PORT || 3306),
    database: required(config, "DB_NAME"),
    user: required(config, "DB_USER"),
    password: required(config, "DB_PASSWORD"),
    charset: "utf8mb4"
  });

  const found = new Map();
  let inTransaction = false;
  try {
    await db.beginTransaction();
    inTransaction = true;
    for (const item of payload.items || []) {
      const snippet = item.snippet || {};
      const statistics = item.statistics || {};
      const thumbnail = snippet.thumbnails?.maxres?.url
        || snippet.thumbnails?.high?.url
        || snippet.thumbnails?.medium?.url
        || snippet.thumbnails?.default?.url;
      if (!thumbnail || !snippet.title || statistics.viewCount === undefined) continue;

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
      found.set(item.id, {
        id: item.id,
        title: snippet.title,
        channelTitle: snippet.channelTitle || "",
        publishedAt: snippet.publishedAt || null,
        thumbnail,
        viewCount: String(statistics.viewCount)
      });
    }
    await db.commit();
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await db.rollback();
    throw error;
  } finally {
    await db.end();
  }

  return {
    requested: ids.length,
    found: found.size,
    videos: ids.map((id) => found.get(id) || { id, unavailable: true })
  };
}
