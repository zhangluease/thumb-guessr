import "./styles.css";
import { createGame } from "./game.js";
import { questions } from "./questions.js";
import { getQuestionId, readRecentQuestionIds } from "./question-history.js";

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
    id: video.id,
    title: video.title,
    views: Number(video.viewCount),
    label: formatViewCount(video.viewCount),
    imageUrl: video.thumbnail,
    imagePosition: "50% 50%",
    choices: buildChoices(video.viewCount)
  };
}

async function fetchRemoteQuestions(excludeIds = []) {
  try {
    const ids = excludeIds
      .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
      .slice(-200);
    const url = new URL("/api/quiz", window.location.origin);
    if (ids.length) url.searchParams.set("exclude", ids.join(","));
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`题库请求失败：${response.status}`);
    const payload = await response.json();
    return (payload.questions || []).map(mapVideoToQuestion);
  } catch (error) {
    console.warn(error);
    return [];
  }
}

async function loadQuestions() {
  const recentIds = readRecentQuestionIds();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remoteQuestions = await fetchRemoteQuestions([...recentIds]);
    const freshQuestions = remoteQuestions.filter((question) => !recentIds.has(getQuestionId(question)));
    if (freshQuestions.length) return freshQuestions;
  }
  return questions;
}

async function loadMoreQuestions(excludeIds) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remoteQuestions = await fetchRemoteQuestions(excludeIds);
    const excluded = new Set(excludeIds);
    const freshQuestions = remoteQuestions.filter((question) => !excluded.has(getQuestionId(question)));
    if (freshQuestions.length) return freshQuestions;
  }
  return [];
}

loadQuestions().then((initialQuestions) => createGame(initialQuestions, { loadMoreQuestions }));
