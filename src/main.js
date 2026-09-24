import "./styles.css";
import { createGame } from "./game.js";
import { questions } from "./questions.js";

function formatViewCount(value) {
  const count = Number(value || 0);
  if (count >= 100000000) return `${(count / 100000000).toFixed(1).replace(/\.0$/, "")} 亿`;
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, "")} 万`;
  return String(count);
}

function buildChoices(value) {
  const count = Number(value || 0);
  const values = [Math.max(1, Math.round(count / 10)), count, Math.max(1, Math.round(count * 10))];
  return [...new Set(values)].map(formatViewCount);
}

function mapVideoToQuestion(video) {
  return {
    title: video.title,
    views: Number(video.viewCount),
    label: formatViewCount(video.viewCount),
    imageUrl: video.thumbnail,
    imagePosition: "50% 50%",
    choices: buildChoices(video.viewCount)
  };
}

async function loadQuestions() {
  try {
    const response = await fetch("/api/quiz", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`题库请求失败：${response.status}`);
    const payload = await response.json();
    const remoteQuestions = (payload.questions || []).map(mapVideoToQuestion);
    if (remoteQuestions.length) return remoteQuestions;
  } catch (error) {
    console.warn(error);
  }
  return questions;
}

loadQuestions().then(createGame);
