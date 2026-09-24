import { loadLocalEnv } from "./env.mjs";
import { syncVideos } from "./youtube-sync-core.mjs";
import { ProxyAgent } from "undici";

loadLocalEnv();

const TARGET = Number(process.env.YOUTUBE_DISCOVERY_TARGET || process.argv.find((value) => /^--target=/.test(value))?.split("=", 2)[1] || 500);
const SEARCH_LIMIT = Number(process.env.YOUTUBE_DISCOVERY_SEARCH_LIMIT || 40);
const CANDIDATE_BUFFER = Math.max(TARGET + 100, Math.ceil(TARGET * 1.25));
const QUERIES = [
  "美食", "街头美食", "家常菜", "烘焙", "旅行", "旅游攻略", "城市漫步", "露营", "钓鱼",
  "宠物", "猫咪", "狗狗", "科技评测", "手机评测", "电脑装机", "人工智能", "编程教程",
  "摄影技巧", "汽车评测", "家居装修", "健身训练", "篮球集锦", "足球集锦", "游戏实况",
  "游戏攻略", "动漫解说", "电影解说", "音乐现场", "舞蹈", "手工DIY", "亲子教育",
  "英语学习", "生活Vlog", "探店", "自然纪录片"
];
const POLITICAL_PATTERN = /新闻|时政|时事|政治|选举|选民|政党|总统|首相|总理|国会|议会|白宫|外交|地缘政治|战争|战事|冲突|军事|军演|制裁|革命|政变|政府|部长|议员|外交部|大使|立法|法案|两岸|台海|中美|中俄|俄乌|乌克兰|普京|泽连斯基|特朗普|川普|拜登|习近平|金正恩|以色列|巴勒斯坦|加沙|伊朗|叙利亚|阿富汗|朝鲜|北约|\bnews\b|\bpolitics\b|\belection\b|\bpresident\b|\bwar\b|\bmilitary\b|\bgovernment\b/i;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`缺少 ${name}，请检查 .env.local`);
  return value;
}

async function youtubeJson(url) {
  const proxyUrl = String(process.env.YOUTUBE_PROXY_URL || "").trim();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        ...(dispatcher ? { dispatcher } : {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = payload?.error?.errors?.[0]?.reason ? ` (${payload.error.errors[0].reason})` : "";
        throw new Error(`${payload?.error?.message || `YouTube API HTTP ${response.status}`}${reason}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    } finally {
      if (dispatcher) await dispatcher.close();
    }
  }
  throw new Error(`YouTube 搜索请求失败（${lastError?.cause?.code || lastError?.message || "unknown"}），已重试 3 次`);
}

function isAllowed(snippet) {
  const title = String(snippet?.title || "").trim();
  const channelTitle = String(snippet?.channelTitle || "").trim();
  return title.length >= 3
    && /[\u3400-\u9fff]/u.test(title)
    && !POLITICAL_PATTERN.test(`${title} ${channelTitle}`);
}

async function collectCandidates(apiKey) {
  const candidates = new Map();
  let requests = 0;
  for (const query of QUERIES) {
    let pageToken = "";
    for (let page = 0; page < 2 && requests < SEARCH_LIMIT; page += 1) {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("order", "viewCount");
      url.searchParams.set("maxResults", "50");
      url.searchParams.set("q", query);
      url.searchParams.set("relevanceLanguage", "zh");
      url.searchParams.set("safeSearch", "moderate");
      url.searchParams.set("videoEmbeddable", "true");
      url.searchParams.set("key", apiKey);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const payload = await youtubeJson(url);
      requests += 1;
      for (const item of payload.items || []) {
        if (!item.id?.videoId || !isAllowed(item.snippet)) continue;
        candidates.set(item.id.videoId, {
          id: item.id.videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle || "",
          query
        });
      }
      console.log(`搜索 ${requests}/${SEARCH_LIMIT}：${query}，候选去重 ${candidates.size}`);
      if (candidates.size >= CANDIDATE_BUFFER || !payload.nextPageToken) break;
      pageToken = payload.nextPageToken;
    }
    if (candidates.size >= CANDIDATE_BUFFER || requests >= SEARCH_LIMIT) break;
  }
  return { candidates: [...candidates.values()], requests };
}

async function syncCandidates(candidates, apiKey) {
  let synced = 0;
  let processed = 0;
  for (let index = 0; index < candidates.length && synced < TARGET; index += 50) {
    const batchSize = Math.min(50, TARGET - synced);
    const batch = candidates.slice(index, index + batchSize);
    const result = await syncVideos(batch.map((item) => item.id), { ...process.env, YOUTUBE_API_KEY: apiKey });
    processed += batch.length;
    synced += result.found;
    console.log(`写入进度：${synced}/${TARGET}，本批 ${result.found}/${batch.length}，已处理候选 ${processed}`);
  }
  return synced;
}

try {
  if (!Number.isInteger(TARGET) || TARGET < 1 || TARGET > 5000) throw new Error("YOUTUBE_DISCOVERY_TARGET 必须是 1-5000 的整数");
  const apiKey = required("YOUTUBE_API_KEY");
  console.log(`开始抓取：目标 ${TARGET} 条，中文标题，排除时政类，搜索请求上限 ${SEARCH_LIMIT}（每次最多 50 条）`);
  const { candidates, requests } = await collectCandidates(apiKey);
  console.log(`候选收集完成：${candidates.length} 条，消耗搜索请求 ${requests} 次`);
  const synced = await syncCandidates(candidates, apiKey);
  if (synced < TARGET) throw new Error(`候选不足或视频不可用，仅写入 ${synced}/${TARGET} 条`);
  console.log(`完成：已写入 ${synced} 条不重复视频`);
} catch (error) {
  console.error(`批量抓取失败：${error.message}`);
  process.exitCode = 1;
}
