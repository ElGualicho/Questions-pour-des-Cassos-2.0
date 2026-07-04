const playerSocket = window.CassosRealtime.connect();
const playerUI = window.CassosUI;
let playerState = null;
let playerToken = localStorage.getItem("cassos.playerToken") || "";

const params = new URLSearchParams(window.location.search);
const joinPanel = playerUI.$("#join-panel");
const playerGame = playerUI.$("#player-game");
const joinForm = playerUI.$("#join-form");
const codeInput = playerUI.$("#join-code");
const nameInput = playerUI.$("#player-name");
const statusLabel = playerUI.$("#player-status");
const themeStrip = playerUI.$("#player-theme-strip");
const roundLabel = playerUI.$("#player-round-label");
const scoreLabel = playerUI.$("#player-score");
const categoryLabel = playerUI.$("#player-category");
const questionText = playerUI.$("#player-question");
const answers = playerUI.$("#player-answers");
const feedbackPanel = playerUI.$("#feedback-panel");
const miniLeaderboard = playerUI.$("#mini-leaderboard");

codeInput.value = params.get("code") || localStorage.getItem("cassos.lastCode") || "";
nameInput.value = localStorage.getItem("cassos.playerName") || "";

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinGame();
});

playerSocket.on("player:state", (payload) => {
  playerState = payload.state;
  render();
});

playerSocket.on("connect", () => {
  if (codeInput.value && nameInput.value) {
    joinGame();
  }
});

function joinGame() {
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (!code || !name) {
    return;
  }

  playerSocket.emit("player:joinGame", { code, name, token: playerToken }, (response) => {
    if (!response || !response.ok) {
      playerUI.showToast((response && response.error) || "Impossible de rejoindre.");
      return;
    }
    playerToken = response.token;
    localStorage.setItem("cassos.playerToken", playerToken);
    localStorage.setItem("cassos.lastCode", code);
    localStorage.setItem("cassos.playerName", name);
    playerState = response.state;
    render();
  });
}

function submitAnswer(answerIndex) {
  if (!playerState || !playerState.me || playerState.me.hasAnswered) {
    return;
  }

  playerSocket.emit(
    "player:submitAnswer",
    { code: playerState.code, token: playerToken, answerIndex },
    (response) => {
      if (!response || !response.ok) {
        playerUI.showToast((response && response.error) || "Réponse refusée.");
        return;
      }
      playerState = response.state;
      render();
    }
  );
}

function render() {
  const joined = Boolean(playerState && playerState.me);
  playerUI.setHidden(joinPanel, joined);
  playerUI.setHidden(playerGame, !joined);

  if (!joined) {
    statusLabel.textContent = "Connexion";
    return;
  }

  statusLabel.textContent = statusText(playerState.status);
  scoreLabel.textContent = playerUI.pointsLabel(playerState.me.score);
  roundLabel.textContent = playerUI.roundLabel(playerState);
  renderQuestion();
  renderLeaderboard();
}

function renderQuestion() {
  const question = playerState.currentQuestion;
  answers.replaceChildren();
  playerUI.setHidden(feedbackPanel, true);

  if (!question) {
    categoryLabel.textContent = "Lobby";
    questionText.textContent =
      playerState.status === "finished" ? "Classement final affiché." : "La partie va commencer.";
    return;
  }

  playerUI.applyTheme(question.theme);
  playerUI.setThemeStrip(themeStrip, question.theme);
  categoryLabel.textContent = `${question.category} · ${question.difficulty}`;
  questionText.textContent = question.question;

  question.choices.forEach((choice, index) => {
    const button = playerUI.createElement("button", "answer-button", choice);
    button.type = "button";
    button.disabled = playerState.status !== "question" || playerState.me.hasAnswered;
    button.addEventListener("click", () => submitAnswer(index));

    if (playerState.me.selectedAnswerIndex === index) {
      button.classList.add("selected");
    }
    if (question.answerIndex !== undefined && question.answerIndex === index) {
      button.classList.add("correct");
    }
    if (
      question.answerIndex !== undefined &&
      playerState.me.selectedAnswerIndex === index &&
      playerState.me.lastAnswerCorrect === false
    ) {
      button.classList.add("wrong");
    }

    answers.append(button);
  });

  renderFeedback(question);
}

function renderFeedback(question) {
  if (playerState.status === "question" && playerState.me.hasAnswered) {
    feedbackPanel.textContent = "Réponse verrouillée, plus moyen de faire le malin.";
    playerUI.setHidden(feedbackPanel, false);
    return;
  }

  if (playerState.answerReveal) {
    feedbackPanel.replaceChildren();
    const title = playerUI.createElement(
      "strong",
      playerState.answerReveal.wasCorrect ? "good" : "bad",
      playerState.answerReveal.wasCorrect ? "Bien vu le sang." : "Terrible choix."
    );
    const answer = playerUI.createElement("span", "", `Bonne réponse : ${question.answerText}`);
    const explanation = playerUI.createElement("p", "", playerState.answerReveal.explanation);
    feedbackPanel.append(title, answer, explanation);
    playerUI.setHidden(feedbackPanel, false);
  }
}

function renderLeaderboard() {
  miniLeaderboard.replaceChildren();
  if (!playerState.leaderboard.length) {
    return;
  }

  for (const player of playerState.leaderboard.slice(0, 5)) {
    const row = playerUI.createElement("div", "leader-row");
    row.append(
      playerUI.createElement("strong", "", `#${player.rank} ${player.name}`),
      playerUI.createElement("span", "", playerUI.pointsLabel(player.score))
    );
    miniLeaderboard.append(row);
  }
}

function statusText(status) {
  return {
    lobby: "Lobby",
    question: "Question",
    revealed: "Réponse",
    finished: "Terminé"
  }[status] || "Partie";
}
