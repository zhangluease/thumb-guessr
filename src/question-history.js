export const RECENT_QUESTION_LIMIT = 200;
export const RECENT_QUESTION_IDS_KEY = "cover-guess-recent-question-ids";

export function getQuestionId(question) {
  return String(question?.id || question?.title || "").trim();
}

export function readRecentQuestionIds() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_QUESTION_IDS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String).filter(Boolean).slice(-RECENT_QUESTION_LIMIT) : []);
  } catch {
    return new Set();
  }
}

export function saveRecentQuestionIds(ids) {
  try {
    localStorage.setItem(
      RECENT_QUESTION_IDS_KEY,
      JSON.stringify([...ids].slice(-RECENT_QUESTION_LIMIT))
    );
  } catch {
    // 隐私模式或存储空间受限时，游戏仍可正常运行，只是不跨刷新去重。
  }
}
