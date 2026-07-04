window.CassosUI = (() => {
  function $(selector) {
    return document.querySelector(selector);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function setHidden(element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle("hidden", Boolean(hidden));
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) {
      return;
    }
    toast.textContent = message;
    setHidden(toast, false);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => setHidden(toast, true), 2400);
  }

  function applyTheme(theme) {
    if (!theme) {
      return;
    }
    document.documentElement.style.setProperty("--theme-accent", theme.accent || "#d9bd28");
    document.documentElement.style.setProperty("--theme-ink", theme.ink || "#101010");
  }

  function setThemeStrip(element, theme) {
    if (!element || !theme) {
      return;
    }
    element.style.backgroundImage = `url("${theme.image}")`;
  }

  function pointsLabel(score) {
    return `${score} pt${score > 1 ? "s" : ""}`;
  }

  function roundLabel(state) {
    if (!state || !state.totalQuestions) {
      return "Lobby";
    }
    if (state.currentQuestion && state.currentQuestion.type === "bonus") {
      return `Question bonus ${state.currentQuestionNumber}/${state.totalQuestions}`;
    }
    return `Question ${state.currentQuestionNumber}/${state.totalQuestions}`;
  }

  function responseLabel(count) {
    return `${count} réponse${count > 1 ? "s" : ""}`;
  }

  return {
    $,
    applyTheme,
    createElement,
    pointsLabel,
    responseLabel,
    roundLabel,
    setHidden,
    setThemeStrip,
    showToast
  };
})();
