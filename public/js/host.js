const hostSocket = window.CassosRealtime.connect();
const hostUI = window.CassosUI;
let hostState = null;

const createButton = hostUI.$("#create-game");
const gamePanel = hostUI.$("#game-panel");
const finalPanel = hostUI.$("#final-panel");
const statusLabel = hostUI.$("#host-status");
const codeLabel = hostUI.$("#game-code");
const qrCode = hostUI.$("#qr-code");
const questionCount = hostUI.$("#question-count");
const questionDuration = hostUI.$("#question-duration");
const startButton = hostUI.$("#start-game");
const resetButton = hostUI.$("#reset-game");
const revealButton = hostUI.$("#reveal-answer");
const nextButton = hostUI.$("#next-question");
const newGameButton = hostUI.$("#new-game");
const playerCount = hostUI.$("#player-count");
const playerList = hostUI.$("#player-list");
const themeStrip = hostUI.$("#theme-strip");
const hostTimer = hostUI.$("#host-timer");
const roundLabel = hostUI.$("#round-label");
const responsesLabel = hostUI.$("#responses-label");
const questionCategory = hostUI.$("#question-category");
const questionText = hostUI.$("#question-text");
const hostAnswers = hostUI.$("#host-answers");
const liveScores = hostUI.$("#host-live-scores");
const leaderboard = hostUI.$("#leaderboard");

createButton.addEventListener("click", () => {
  hostSocket.emit("host:createGame", {}, handleReply((payload) => {
    persistGame(payload.state.code);
    receiveHostState(payload);
  }));
});

startButton.addEventListener("click", () => {
  if (!hostState) {
    return;
  }
  hostSocket.emit(
    "host:startGame",
    {
      code: hostState.code,
      questionCount: questionCount.value,
      questionDurationMs: questionDuration.value
    },
    handleReply(receiveHostState)
  );
});

resetButton.addEventListener("click", () => {
  resetCurrentGame();
});

newGameButton.addEventListener("click", () => {
  resetCurrentGame();
});

function resetCurrentGame() {
  if (!hostState) {
    return;
  }
  hostSocket.emit("host:resetGame", { code: hostState.code }, handleReply((payload) => {
    persistGame(payload.state.code);
    receiveHostState(payload);
  }));
}

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

window.setInterval(renderLiveQuestionState, 250);

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
  render();
}

function renderLiveQuestionState() {
  if (!hostState || hostState.status !== "question") {
    return;
  }
  renderControls();
  renderHostTimer();
}

function render() {
  const hasGame = Boolean(hostState);
  document.body.classList.toggle("game-active", hasGame);
  document.body.classList.toggle("host-empty", !hasGame);
  document.body.classList.toggle("host-lobby", hasGame && hostState.status === "lobby");
  document.body.classList.toggle("host-round", hasGame && hostState.status !== "lobby");
  document.body.classList.toggle("host-question", hasGame && hostState.status === "question");
  document.body.classList.toggle("host-revealed", hasGame && hostState.status === "revealed");
  document.body.classList.toggle("host-finished", hasGame && hostState.status === "finished");
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
  questionDuration.value = String(hostState.settings.questionDurationMs || hostState.questionDurationMs || 10000);
  playerCount.textContent = String(hostState.players.length);

  renderPlayers();
  renderLiveScores();
  renderQuestion();
  renderControls();
  renderHostTimer();
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
    const remove = hostUI.createElement("button", "icon-action compact-action", "×");
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

function renderLiveScores() {
  liveScores.replaceChildren();
  const visible = Boolean(
    hostState &&
      hostState.status !== "lobby" &&
      hostState.status !== "finished" &&
      hostState.leaderboard.length
  );
  hostUI.setHidden(liveScores, !visible);
  liveScores.classList.toggle(
    "is-compact",
    visible && hostState.leaderboard.length <= 3
  );
  if (!visible) {
    return;
  }

  const speedLeaderCount = Math.max(
    0,
    ...hostState.leaderboard.map((player) => player.speedBonusCount || 0)
  );

  for (const player of hostState.leaderboard) {
    const speedCount = player.speedBonusCount || 0;
    const isSpeedLeader = speedLeaderCount > 0 && speedCount === speedLeaderCount;
    const card = hostUI.createElement("div", "live-score-card");
    card.classList.toggle("is-score-leader", player.rank === 1);
    card.classList.toggle("is-speed-leader", isSpeedLeader);
    card.classList.toggle("just-won-speed", Boolean(player.lastSpeedBonus));

    const main = hostUI.createElement("div", "live-score-main");
    main.append(
      hostUI.createElement("span", "live-score-rank", `#${player.rank}`),
      hostUI.createElement("strong", "live-score-name", player.name),
      hostUI.createElement("span", "live-score-points", hostUI.pointsLabel(player.score))
    );

    const detail = hostUI.createElement("div", "live-score-detail");
    const speed = hostUI.createElement(
      "span",
      "live-speed-stat",
      `Vitesse ${speedCount}${isSpeedLeader ? " · en tête" : ""}`
    );
    const answerState = hostUI.createElement(
      "span",
      player.hasAnswered ? "live-answer-state has-answered" : "live-answer-state",
      player.connected ? (player.hasAnswered ? "répondu" : "attente") : "hors ligne"
    );
    detail.append(speed, answerState);
    card.append(main, detail);
    liveScores.append(card);
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
    hostUI.setHidden(hostTimer, true);
    themeStrip.style.backgroundImage = "";
    hostAnswers.classList.remove("many-answers");
    return;
  }

  hostUI.applyTheme(question.theme);
  hostUI.setThemeStrip(themeStrip, question.theme);
  hostAnswers.classList.toggle("many-answers", question.type === "bonus");
  questionCategory.textContent = hostUI.categoryLabel(question);
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
  const canReveal = isQuestion && canRevealCurrentQuestion();

  startButton.disabled = !isLobby;
  questionCount.disabled = !isLobby;
  questionDuration.disabled = !isLobby;
  revealButton.disabled = !canReveal;
  revealButton.title = isQuestion && !canReveal
    ? `Disponible après ${Math.round((hostState.questionDurationMs || 10000) / 1000)} secondes ou quand tout le monde a répondu.`
    : "";
  nextButton.disabled = !isRevealed;
  newGameButton.disabled = isLobby;
  hostUI.setHidden(newGameButton, isLobby);
  resetButton.disabled = false;
  nextButton.textContent =
    hostState.currentQuestionNumber >= hostState.totalQuestions ? "Voir le classement" : "Question suivante";

  if (isFinished) {
    revealButton.disabled = true;
    nextButton.disabled = true;
  }
}

function renderHostTimer() {
  const visible = Boolean(hostState && hostState.status === "question" && hostState.currentQuestion);
  hostUI.setHidden(hostTimer, !visible);
  if (!visible) {
    return;
  }
  hostTimer.textContent = hostUI.countdownLabel(hostState);
}

function canRevealCurrentQuestion() {
  return Boolean(
    hostState &&
      (hostState.canReveal || hostState.allAnswered || hostUI.questionTimeRemainingMs(hostState) <= 0)
  );
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
