import "./youtube-test.css";

const form = document.querySelector("#youtube-form");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const inputs = [document.querySelector("#video-one"), document.querySelector("#video-two")];

function setStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

function formatViews(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

function createResultCard(video) {
  const card = document.createElement("article");
  card.className = "result-card";

  if (video.unavailable) {
    const unavailable = document.createElement("p");
    unavailable.className = "unavailable";
    unavailable.textContent = `视频 ${video.id} 不可用、已删除或没有公开数据`;
    card.append(unavailable);
    return card;
  }

  const image = document.createElement("img");
  image.src = video.thumbnail;
  image.alt = video.title;
  image.loading = "lazy";

  const body = document.createElement("div");
  body.className = "result-body";
  const title = document.createElement("h2");
  title.textContent = video.title;
  const views = document.createElement("strong");
  views.textContent = `${formatViews(video.viewCount)} 次播放`;
  const meta = document.createElement("p");
  meta.textContent = `${video.channelTitle || "未知频道"} · 发布于 ${formatDate(video.publishedAt)}`;
  const id = document.createElement("code");
  id.textContent = video.id;
  body.append(title, views, meta, id);
  card.append(image, body);
  return card;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = inputs.map((input) => input.value.trim()).filter(Boolean);
  if (values.length !== 2) {
    setStatus("请填写两个视频链接或 ID", "error");
    return;
  }

  const params = new URLSearchParams();
  values.forEach((value) => params.append("id", value));
  results.replaceChildren();
  setStatus("正在读取 ECS 数据库…", "loading");

  try {
    const response = await fetch(`/api/youtube/videos?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "请求失败");
    results.append(...payload.videos.map(createResultCard));
    setStatus(`已读取 ${payload.found}/${payload.requested} 条视频数据`, payload.found ? "success" : "error");
  } catch (error) {
    setStatus(error.message || "请求失败，请稍后重试", "error");
  }
});
