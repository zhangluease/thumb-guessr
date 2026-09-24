import { loadLocalEnv } from "./env.mjs";
import { syncVideos } from "./youtube-sync-core.mjs";

loadLocalEnv();
const inputs = process.argv.slice(2).flatMap((value) => value.split(/[\s,]+/)).filter(Boolean);

if (!inputs.length) {
  console.error("用法：npm run youtube:sync -- <YouTube 链接或视频 ID> [第二个链接或 ID]");
  process.exit(2);
}

try {
  const result = await syncVideos(inputs);
  console.log(`已同步 ${result.found}/${result.requested} 条视频到数据库`);
  for (const video of result.videos) console.log(`${video.unavailable ? "MISS" : "OK"}\t${video.id}`);
} catch (error) {
  console.error(`同步失败：${error.message}`);
  process.exitCode = 1;
}
