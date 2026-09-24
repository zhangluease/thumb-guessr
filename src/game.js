import {
  getQuestionId,
  readRecentQuestionIds,
  saveRecentQuestionIds
} from "./question-history.js";

export function createGame(initialQuestions, { loadMoreQuestions } = {}) {
  if (!Array.isArray(initialQuestions) || initialQuestions.length === 0) {
    throw new Error("题库不能为空");
  }

  const el = (id) => document.getElementById(id);
  const recentIds = readRecentQuestionIds();
  const state = {
    fallbackQuestions: initialQuestions,
    pendingQuestions: [],
    currentQuestion: null,
    index: 0,
    score: 0,
    streak: 0,
    best: Number(localStorage.getItem("cover-guess-best") || 0),
    answered: false,
    loading: false
  };
  const elements = {
    round: el("round"), score: el("score"), streak: el("streak"), best: el("best"), choices: el("choices"),
    cover: el("cover-card"), image: el("cover-image"), reveal: el("reveal-card"), actual: el("actual-count"),
    questionTitle: el("question-title"), result: el("result"), resultTitle: el("result-title"), resultDetail: el("result-detail"),
    next: el("next-button"), prompt: el("prompt")
  };
  const nextLabel = elements.next.textContent || "下一题";

  function shuffled(list) {
    const result = [...list];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function rememberQuestion(question) {
    const id = getQuestionId(question);
    if (!id) return;
    recentIds.delete(id);
    recentIds.add(id);
    while (recentIds.size > 200) recentIds.delete(recentIds.values().next().value);
    saveRecentQuestionIds(recentIds);
  }

  function enqueueQuestions(list) {
    const pendingIds = new Set(state.pendingQuestions.map(getQuestionId));
    const fresh = list.filter((question) => {
      const id = getQuestionId(question);
      return id && !recentIds.has(id) && !pendingIds.has(id);
    });
    state.pendingQuestions.push(...shuffled(fresh));
  }

  function renderQuestion(question) {
    state.currentQuestion = question;
    state.answered = false;
    elements.round.textContent = String(state.index).padStart(2, "0");
    const hasRemoteImage = Boolean(question.imageUrl);
    elements.cover.classList.toggle("is-dynamic", hasRemoteImage);
    elements.image.style.backgroundImage = hasRemoteImage
      ? `url("${question.imageUrl.replaceAll('"', "%22")}")`
      : "url('/assets/cover-deck.png')";
    elements.image.style.backgroundSize = hasRemoteImage ? "contain" : "300% 200%";
    elements.image.style.backgroundColor = hasRemoteImage ? "#0e1020" : "transparent";
    elements.image.style.backgroundPosition = hasRemoteImage ? "center" : (question.imagePosition || "0% 0%");
    elements.questionTitle.textContent = question.title;
    elements.reveal.classList.remove("is-visible");
    elements.reveal.setAttribute("aria-hidden", "true");
    elements.cover.classList.remove("is-revealed", "is-correct", "is-wrong");
    elements.result.hidden = true;
    elements.prompt.textContent = "这条视频的播放量会是多少？";
    elements.choices.replaceChildren(...shuffled(question.choices).map((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.dataset.value = choice;
      button.innerHTML = `<span class="choice-index">${index + 1}</span><span>${choice}</span>`;
      button.setAttribute("aria-label", `选择 ${choice}`);
      button.addEventListener("click", () => answer(choice, button));
      return button;
    }));
  }

  async function nextQuestion() {
    if (state.loading) return;
    if (!state.pendingQuestions.length && loadMoreQuestions) {
      state.loading = true;
      elements.next.disabled = true;
      elements.next.textContent = "加载中…";
      try {
        enqueueQuestions(await loadMoreQuestions([...recentIds]));
      } catch (error) {
        console.warn("加载更多题目失败", error);
      } finally {
        state.loading = false;
        elements.next.disabled = false;
        elements.next.textContent = nextLabel;
      }
    }

    if (!state.pendingQuestions.length) {
      // 接口不可用且内置题库小于 200 条时，允许降级重复，避免游戏卡死。
      const fallback = state.fallbackQuestions.find((question) => !recentIds.has(getQuestionId(question)))
        || state.fallbackQuestions[0];
      state.pendingQuestions.push(fallback);
    }

    const question = state.pendingQuestions.shift();
    state.index += 1;
    rememberQuestion(question);
    renderQuestion(question);
  }

  function answer(choice, selected) {
    if (state.answered || !state.currentQuestion) return;
    state.answered = true;
    const question = state.currentQuestion;
    const isCorrect = choice === question.label;
    const buttons = [...elements.choices.querySelectorAll("button")];
    buttons.forEach((button) => {
      button.disabled = true;
      if (button.dataset.value === question.label) button.classList.add("is-correct");
    });
    if (!isCorrect) selected.classList.add("is-wrong");

    state.streak = isCorrect ? state.streak + 1 : 0;
    state.score += isCorrect ? 100 + Math.max(0, state.streak - 1) * 25 : 0;
    state.best = Math.max(state.best, state.streak);
    localStorage.setItem("cover-guess-best", String(state.best));
    elements.streak.textContent = state.streak;
    elements.score.textContent = state.score;
    elements.best.textContent = state.best;
    elements.actual.textContent = question.label;
    elements.cover.classList.add("is-revealed", isCorrect ? "is-correct" : "is-wrong");
    elements.reveal.classList.add("is-visible");
    elements.reveal.setAttribute("aria-hidden", "false");
    elements.prompt.textContent = isCorrect ? "直觉很准！" : "差一点，下一题继续。";
    elements.resultTitle.textContent = isCorrect ? `答对了 +${100 + Math.max(0, state.streak - 1) * 25}` : "答案揭晓";
    elements.resultDetail.textContent = isCorrect ? `已连续答对 ${state.streak} 题` : `真实播放量是 ${question.label}`;
    elements.result.hidden = false;
    elements.next.focus();
  }

  elements.next.addEventListener("click", () => { nextQuestion(); });
  document.addEventListener("keydown", (event) => {
    if (state.answered && (event.key === "Enter" || event.key === " ")) return elements.next.click();
    if (!state.answered && /^[1-3]$/.test(event.key)) elements.choices.querySelectorAll("button")[Number(event.key) - 1]?.click();
  });
  elements.best.textContent = state.best;
  enqueueQuestions(initialQuestions);
  nextQuestion();
}
