import OSS from "ali-oss";
import { ProxyAgent } from "undici";

function required(config, name) {
  const value = String(config[name] || "").trim();
  if (!value) throw new Error(`缺少 ${name}，请在本地 .env.local 配置阿里云 OSS`);
  return value;
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function createOssUploader(config) {
  if (String(config.OSS_ENABLED || "true").toLowerCase() === "false") return null;

  const publicBaseUrl = required(config, "OSS_PUBLIC_BASE_URL").replace(/\/+$/, "");
  const objectPrefix = (config.OSS_OBJECT_PREFIX || "thumb-guessr/covers").replace(/^\/+|\/+$/g, "");
  const client = new OSS({
    region: required(config, "OSS_REGION"),
    bucket: required(config, "OSS_BUCKET"),
    accessKeyId: required(config, "OSS_ACCESS_KEY_ID"),
    accessKeySecret: required(config, "OSS_ACCESS_KEY_SECRET"),
    endpoint: config.OSS_ENDPOINT || undefined,
    secure: true
  });

  return {
    async uploadThumbnail(videoId, sourceUrl) {
      const proxyUrl = String(config.YOUTUBE_PROXY_URL || "").trim();
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
        try {
          const response = await fetch(sourceUrl, {
            headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
            ...(dispatcher ? { dispatcher } : {})
          });
          if (!response.ok) throw new Error(`封面下载失败：HTTP ${response.status}`);
          const contentType = (response.headers.get("content-type") || "image/jpeg").split(";", 1)[0].toLowerCase();
          const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
          const objectKey = `${objectPrefix}/${videoId}.${extension}`;
          const buffer = Buffer.from(await response.arrayBuffer());
          await client.put(objectKey, buffer, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000, immutable"
            }
          });
          return joinUrl(publicBaseUrl, objectKey);
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
        } finally {
          if (dispatcher) await dispatcher.close();
        }
      }
      throw new Error(`封面上传 OSS 失败（${lastError?.cause?.code || lastError?.message || "unknown"}），已重试 3 次`);
    }
  };
}
