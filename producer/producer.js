const form = document.querySelector("#sync-form");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const videos = [document.querySelector("#video-one").value.trim(), document.querySelector("#video-two").value.trim()].filter(Boolean);
  status.textContent = "正在从本地网络请求 YouTube 并写入 MySQL…";
  results.replaceChildren();
  try {
    const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "同步失败");
    status.textContent = `同步完成：${payload.found}/${payload.requested} 条`;
    for (const video of payload.videos) {
      const item = document.createElement("article");
      item.className = "result";
      item.textContent = video.unavailable ? `${video.id}：未找到` : `${video.title} · ${Number(video.viewCount).toLocaleString("zh-CN")} 次播放`;
      results.append(item);
    }
  } catch (error) {
    status.textContent = error.message || "同步失败";
  }
});
