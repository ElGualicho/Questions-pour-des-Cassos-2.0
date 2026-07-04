const hostSocket = window.CassosRealtime.connect();
const hostUI = window.CassosUI;
let hostState = null;
let joinUrl = "";

const createButton = hostUI.$("#create-game");
const gamePanel = hostUI.$("#game-panel");
const finalPanel = hostUI.$("#final-panel");
const statusLabel = hostUI.$("#host-status");
const codeLabel = hostUI.$("#game-code");
const qrCode = hostUI.$("#qr-code");
const copyLinkButton = hostUI.$("#copy-link");
const questionCount = hostUI.$("#question-count");
const startButton = hostUI.$("#start-game");
const resetButton = hostUI.$("#reset-game");
const revealButton = hostUI.$("#reveal-answer");
const nextButton = hostUI.$("#next-question");
const playerCount = hostUI.$("#player-count");
const playerList = hostUI.$("#player-list");
const themeStrip = hostUI.$("#theme-strip");
const roundLabel = hostUI.$("#round-label");
const responsesLabel = hostUI.$("#responses-label");
const questionCategory = hostUI.$("#question-category");
const questionText = hostUI.$("#question-text");
const hostAnswers = hostUI.$("#host-answers");
const leaderboard = hostUI.$("#leaderboard");

createButton.addEventListener("click", () => {
  hostSocket.emit("host:createGame", {}, handleReply((payload) => {
    persistGame(payload.state.code);
    receiveHostState(payload);
  }));
});

copyLinkButton.addEventListener("click", async () => {
  const absoluteUrl = new URL(joinUrl, window.location.origin).toString();
  await navigator.clipboard.writeText(absoluteUrl);
  hostUI.showToast("Lien copié.");
});

startButton.addEventListener("click", () => {
  if (!hostState) {
    return;
  }
  hostSocket.emit(
    "host:startGame",
    { code: hostState.code, questionCount: questionCount.value },
    handleReply(receiveHostState)
  );
});

resetButton.addEventListener("click", () => {
  if (!hostState) {
    return;
  }
  hostSocket.emit("host:resetGame", { code: hostState.code }, handleReply(receiveHostState));
});

revealButton.addEventListener("click", () => {
  if (!hostState) {
    return;
  }
  hostSocket.emit("host:revealAnswer", { code: hostState.code }, handleReply(receiveHostState));
});

nextButton.addEventListener("click", () => {
  if (!hostState) {
    return;
  }
  hostSocket.emit("host:nextQuestion", { code: hostState.code }, handleReply(receiveHostState));
});

hostSocket.on("host:state", receiveHostState);

hostSocket.on("connect", () => {
  const code = localStorage.getItem("cassos.hostCode");
  if (!code) {
    render();
    return;
  }
  hostSocket.emit("host:resumeGame", { code }, (response) => {
    if (response && response.ok) {
      receiveHostState(response);
      return;
    }
    localStorage.removeItem("cassos.hostCode");
    render();
  });
});

function receiveHostState(payload) {
  hostState = payload.state;
  joinUrl = payload.joinUrl || (hostState ? `/join/${hostState.code}` : "");
  render();
}

function render() {
  const hasGame = Boolean(hostState);
  document.body.classList.toggle("game-active", hasGame);
  hostUI.setHidden(gamePanel, !hasGame);
  hostUI.setHidden(finalPanel, !hasGame || hostState.status !== "finished");
  createButton.disabled = hasGame;

  if (!hasGame) {
    statusLabel.textContent = "Pas de partie";
    return;
  }

  codeLabel.textContent = hostState.code;
  qrCode.src = `/api/games/${encodeURIComponent(hostState.code)}/qr.svg`;
  statusLabel.textContent = statusText(hostState.status);
  questionCount.value = String(hostState.settings.questionCount);
  playerCount.textContent = String(hostState.players.length);

  renderPlayers();
  renderQuestion();
  renderControls();
  renderLeaderboard();
}

function renderPlayers() {
  playerList.replaceChildren();
  if (!hostState.players.length) {
    playerList.append(hostUI.createElement("p", "muted", "Personne pour l'instant."));
    return;
  }

  for (const player of hostState.players) {
    const row = hostUI.createElement("div", "player-row");
    const name = hostUI.createElement("div", "", player.name);
    const meta = hostUI.createElement(
      "span",
      player.connected ? "pill" : "pill muted-pill",
      `${hostUI.pointsLabel(player.score)} · ${player.hasAnswered ? "répondu" : "attente"}`
    );
    const remove = hostUI.createElement("button", "icon-action compact-action", "X");
    remove.type = "button";
    remove.title = "Retirer";
    remove.setAttribute("aria-label", `Retirer ${player.name}`);
    remove.addEventListener("click", () => {
      hostSocket.emit(
        "host:removePlayer",
        { code: hostState.code, token: player.token },
        handleReply(receiveHostState)
      );
    });

    row.append(name, meta, remove);
    playerList.append(row);
  }
}

function renderQuestion() {
  const question = hostState.currentQuestion;
  roundLabel.textContent = hostUI.roundLabel(hostState);
  responsesLabel.textContent = hostUI.responseLabel(hostState.responsesCount);
  hostAnswers.replaceChildren();

  if (!question) {
    questionCategory.textContent = "Lobby";
    questionText.textContent = "Partage le code, laisse les joueurs entrer, puis lance la partie.";
    themeStrip.style.backgroundImage = "";
    hostAnswers.classList.remove("many-answers");
    return;
  }

  hostUI.applyTheme(question.theme);
  hostUI.setThemeStrip(themeStrip, question.theme);
  hostAnswers.classList.toggle("many-answers", question.type === "bonus");
  questionCategory.textContent = `${question.category} · ${question.difficulty}`;
  questionText.textContent = question.question;

  for (const answer of hostState.answerDistribution) {
    const button = hostUI.createElement("div", "answer-card");
    const label = hostUI.createElement("strong", "", answer.choice);
    const count = hostUI.createElement("span", "", `${answer.count}`);
    const bar = hostUI.createElement("div", "answer-bar");
    const fill = hostUI.createElement("span");
    const percent = hostState.responsesCount ? (answer.count / hostState.responsesCount) * 100 : 0;
    fill.style.width = `${percent}%`;
    bar.append(fill);
    if (answer.correct === true) {
      button.classList.add("correct");
    }
    button.append(label, count, bar);
    hostAnswers.append(button);
  }
}

function renderControls() {
  const isLobby = hostState.status === "lobby";
  const isQuestion = hostState.status === "question";
  const isRevealed = hostState.status === "revealed";
  const isFinished = hostState.status === "finished";

  startButton.disabled = !isLobby;
  questionCount.disabled = !isLobby;
  revealButton.disabled = !isQuestion;
  nextButton.disabled = !isRevealed;
  resetButton.disabled = false;
  nextButton.textContent =
    hostState.currentQuestionNumber >= hostState.totalQuestions ? "Voir le classement" : "Question suivante";

  if (isFinished) {
    revealButton.disabled = true;
    nextButton.disabled = true;
  }
}

function renderLeaderboard() {
  leaderboard.replaceChildren();
  for (const player of hostState.leaderboard) {
    const row = hostUI.createElement("div", "leader-row");
    row.append(
      hostUI.createElement("strong", "", `#${player.rank} ${player.name}`),
      hostUI.createElement("span", "", hostUI.pointsLabel(player.score))
    );
    leaderboard.append(row);
  }
}

function handleReply(onSuccess) {
  return (response) => {
    if (!response || !response.ok) {
      hostUI.showToast((response && response.error) || "Action impossible.");
      return;
    }
    onSuccess(response);
  };
}

function persistGame(code) {
  localStorage.setItem("cassos.hostCode", code);
}

function statusText(status) {
  return {
    lobby: "Lobby",
    question: "Question en cours",
    revealed: "Réponse révélée",
    finished: "Terminé"
  }[status] || "Partie";
}
