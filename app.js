(function () {
  const questions = window.QUESTIONS;
  const el = (id) => document.getElementById(id);
  const state = { index: 0, score: 0, streak: 0, best: Number(localStorage.getItem("cover-guess-best") || 0), answered: false };
  const elements = {
    round: el("round"), score: el("score"), streak: el("streak"), best: el("best"), choices: el("choices"),
    cover: el("cover-card"), image: el("cover-image"), reveal: el("reveal-card"), actual: el("actual-count"),
    videoTitle: el("video-title"), result: el("result"), resultTitle: el("result-title"), resultDetail: el("result-detail"),
    next: el("next-button"), prompt: el("prompt")
  };

  function shuffled(list) {
    return [...list].sort(() => Math.random() - 0.5);
  }

  function renderQuestion() {
    const question = questions[state.index % questions.length];
    state.answered = false;
    elements.round.textContent = String(state.index + 1).padStart(2, "0");
    elements.image.style.backgroundPosition = question.imagePosition;
    elements.reveal.classList.remove("is-visible");
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

  function answer(choice, selected) {
    if (state.answered) return;
    state.answered = true;
    const question = questions[state.index % questions.length];
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
    elements.videoTitle.textContent = question.title;
    elements.cover.classList.add("is-revealed", isCorrect ? "is-correct" : "is-wrong");
    elements.reveal.classList.add("is-visible");
    elements.prompt.textContent = isCorrect ? "直觉很准！" : "差一点，下一题继续。";
    elements.resultTitle.textContent = isCorrect ? `答对了 +${100 + Math.max(0, state.streak - 1) * 25}` : "答案揭晓";
    elements.resultDetail.textContent = isCorrect ? `已连续答对 ${state.streak} 题` : `真实播放量是 ${question.label}`;
    elements.result.hidden = false;
    elements.next.focus();
  }

  elements.next.addEventListener("click", () => { state.index += 1; renderQuestion(); });
  document.addEventListener("keydown", (event) => {
    if (state.answered && (event.key === "Enter" || event.key === " ")) return elements.next.click();
    if (!state.answered && /^[1-3]$/.test(event.key)) elements.choices.querySelectorAll("button")[Number(event.key) - 1]?.click();
  });
  elements.best.textContent = state.best;
  renderQuestion();
})();
