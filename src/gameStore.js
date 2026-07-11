const crypto = require("crypto");
const { getThemeForCategory } = require("./themes");

const DEFAULT_QUESTION_COUNT = 10;
const DEFAULT_QUESTION_DURATION_MS = 10000;
const VALID_COUNTS = new Set([10, 20, 30, 40, "all"]);
const VALID_QUESTION_DURATIONS_MS = new Set([10000, 15000, 20000]);
const BONUS_QUESTION_ID = "bonus-daronne-finale";
const BONUS_QUESTION_TEXT =
  "Parmi les joueurs présents, quelle daronne m\u00e9rite le titre de plus grosse salope ?";
const BONUS_QUESTION_EXPLANATION =
  "Le joueur dont le nom re\u00e7oit le plus de votes remporte 2 points bonus.";
const BONUS_THEME_CATEGORY = "Corps, cul & malaise poli";

function createGameStore(rawQuestions) {
  const questions = validateQuestions(rawQuestions);
  const games = new Map();

  function createGame(hostSocketId) {
    const code = createUniqueCode(games);
    const game = {
      code,
      hostSocketId,
      hostConnected: true,
      status: "lobby",
      players: new Map(),
      deck: [],
      currentQuestionIndex: -1,
      currentAnswers: new Map(),
      currentScored: false,
      questionStartedAt: null,
      questionDeadlineAt: null,
      settings: {
        questionCount: DEFAULT_QUESTION_COUNT,
        questionDurationMs: DEFAULT_QUESTION_DURATION_MS
      },
      createdAt: Date.now()
    };

    games.set(code, game);
    return game;
  }

  function getGame(code) {
    return games.get(normalizeCode(code)) || null;
  }

  function requireGame(code) {
    const game = getGame(code);
    if (!game) {
      throw new Error("Partie introuvable.");
    }
    return game;
  }

  function attachHost(code, socketId) {
    const game = requireGame(code);
    game.hostSocketId = socketId;
    game.hostConnected = true;
    return game;
  }

  function startGame(code, settings = {}) {
    const game = requireGame(code);
    const questionCount = parseQuestionCount(settings.questionCount);
    const questionDurationMs = parseQuestionDurationMs(settings.questionDurationMs);
    game.settings.questionCount = questionCount;
    game.settings.questionDurationMs = questionDurationMs;
    game.deck = buildDeck(questions, questionCount);
    game.deck.push(buildBonusQuestion(game));
    game.currentQuestionIndex = 0;
    resetRoundAnswers(game);
    game.status = "question";
    return game;
  }

  function nextQuestion(code) {
    const game = requireGame(code);
    if (!game.deck.length) {
      return startGame(code, game.settings);
    }

    if (game.currentQuestionIndex + 1 >= game.deck.length) {
      applyScoring(game);
      game.status = "finished";
      game.questionStartedAt = null;
      game.questionDeadlineAt = null;
      return game;
    }

    game.currentQuestionIndex += 1;
    if (isCurrentQuestionBonus(game)) {
      game.deck[game.currentQuestionIndex] = buildBonusQuestion(game);
    }
    resetRoundAnswers(game);
    game.status = "question";
    return game;
  }

  function revealAnswer(code) {
    const game = requireGame(code);
    if (!getCurrentQuestion(game)) {
      throw new Error("Aucune question active.");
    }
    if (game.status === "question" && !canRevealQuestion(game)) {
      throw new Error("La question est encore en cours.");
    }

    applyScoring(game);
    game.status = "revealed";
    return game;
  }

  function resetGame(code) {
    const game = requireGame(code);
    const previousCode = game.code;
    const newCode = createUniqueCode(games);

    games.delete(previousCode);
    game.code = newCode;
    games.set(newCode, game);

    game.status = "lobby";
    game.deck = [];
    game.currentQuestionIndex = -1;
    game.currentAnswers.clear();
    game.currentScored = false;
    game.questionStartedAt = null;
    game.questionDeadlineAt = null;

    for (const player of game.players.values()) {
      player.score = 0;
      player.correctCount = 0;
      player.speedBonusCount = 0;
      player.hasAnswered = false;
      player.selectedAnswerIndex = null;
      player.lastAnswerCorrect = null;
      player.lastAnswerPoints = 0;
      player.lastSpeedBonus = false;
      player.lastBonusAwarded = false;
    }

    return game;
  }

  function joinPlayer(code, name, token, socketId) {
    const game = requireGame(code);
    const cleanName = normalizePlayerName(name);
    const playerToken = token && game.players.has(token) ? token : createPlayerToken();
    const existing = game.players.get(playerToken);

    const player = existing || {
      token: playerToken,
      score: 0,
      correctCount: 0,
      speedBonusCount: 0,
      joinedAt: Date.now(),
      hasAnswered: false,
      selectedAnswerIndex: null,
      lastAnswerCorrect: null,
      lastAnswerPoints: 0,
      lastSpeedBonus: false,
      lastBonusAwarded: false
    };

    player.name = cleanName;
    player.socketId = socketId;
    player.connected = true;
    game.players.set(playerToken, player);

    return { game, player };
  }

  function submitAnswer(code, token, answerIndex) {
    const game = requireGame(code);
    const player = requirePlayer(game, token);
    const currentQuestion = getCurrentQuestion(game);

    if (game.status !== "question" || !currentQuestion) {
      throw new Error("La question n'accepte plus de réponse.");
    }

    if (isQuestionExpired(game)) {
      throw new Error("Le temps est écoulé.");
    }

    const parsedAnswer = Number(answerIndex);
    if (!Number.isInteger(parsedAnswer) || parsedAnswer < 0 || parsedAnswer >= currentQuestion.choices.length) {
      throw new Error("Réponse invalide.");
    }

    player.hasAnswered = true;
    player.selectedAnswerIndex = parsedAnswer;
    player.lastAnswerCorrect = null;
    game.currentAnswers.set(player.token, {
      answerIndex: parsedAnswer,
      answeredAt: Date.now()
    });

    return game;
  }

  function removePlayer(code, token) {
    const game = requireGame(code);
    game.players.delete(token);
    game.currentAnswers.delete(token);
    return game;
  }

  function disconnectSocket(socketId) {
    const affectedGames = [];

    for (const game of games.values()) {
      let affected = false;

      if (game.hostSocketId === socketId) {
        game.hostConnected = false;
        affected = true;
      }

      for (const player of game.players.values()) {
        if (player.socketId === socketId) {
          player.connected = false;
          affected = true;
        }
      }

      if (affected) {
        affectedGames.push(game);
      }
    }

    return affectedGames;
  }

  function getHostState(input) {
    const game = typeof input === "string" ? requireGame(input) : input;
    const currentQuestion = getCurrentQuestion(game);
    const includeAnswer = game.status === "revealed" || game.status === "finished";

    return {
      code: game.code,
      status: game.status,
      hostConnected: game.hostConnected,
      settings: game.settings,
      players: getPlayers(game),
      currentQuestion: currentQuestion ? sanitizeQuestion(currentQuestion, includeAnswer) : null,
      currentQuestionNumber: currentQuestion ? game.currentQuestionIndex + 1 : 0,
      totalQuestions: game.deck.length,
      responsesCount: game.currentAnswers.size,
      allAnswered: allPlayersAnswered(game),
      canReveal: canRevealQuestion(game),
      questionDurationMs: game.settings.questionDurationMs || DEFAULT_QUESTION_DURATION_MS,
      questionStartedAt: game.questionStartedAt,
      questionDeadlineAt: game.questionDeadlineAt,
      questionTimeRemainingMs: getQuestionTimeRemainingMs(game),
      answerDistribution: getAnswerDistribution(game),
      leaderboard: getLeaderboard(game)
    };
  }

  function getPlayerState(input, token) {
    const game = typeof input === "string" ? requireGame(input) : input;
    const player = token ? game.players.get(token) : null;
    const currentQuestion = getCurrentQuestion(game);
    const includeAnswer = game.status === "revealed" || game.status === "finished";
    const sanitizedQuestion = currentQuestion ? sanitizeQuestion(currentQuestion, includeAnswer) : null;

    return {
      code: game.code,
      status: game.status,
      me: player ? publicPlayer(player) : null,
      players: getPlayers(game).map(({ token: _token, ...publicFields }) => publicFields),
      currentQuestion: sanitizedQuestion,
      currentQuestionNumber: currentQuestion ? game.currentQuestionIndex + 1 : 0,
      totalQuestions: game.deck.length,
      responsesCount: game.currentAnswers.size,
      questionDurationMs: game.settings.questionDurationMs || DEFAULT_QUESTION_DURATION_MS,
      questionStartedAt: game.questionStartedAt,
      questionDeadlineAt: game.questionDeadlineAt,
      questionTimeRemainingMs: getQuestionTimeRemainingMs(game),
      answerLocked: game.status !== "question" || isQuestionExpired(game),
      answerReveal: buildAnswerReveal(game, player, currentQuestion),
      leaderboard: getLeaderboard(game).map(({ token: _token, ...publicFields }) => publicFields)
    };
  }

  return {
    attachHost,
    createGame,
    disconnectSocket,
    getGame,
    getHostState,
    getPlayerState,
    joinPlayer,
    nextQuestion,
    removePlayer,
    resetGame,
    revealAnswer,
    startGame,
    submitAnswer
  };
}

function validateQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) {
    throw new Error("La banque de questions doit être un tableau.");
  }

  const ids = new Set();

  for (const question of rawQuestions) {
    if (!question.id || ids.has(question.id)) {
      throw new Error(`Question avec id absent ou dupliqué: ${question.id}`);
    }
    ids.add(question.id);

    if (!Array.isArray(question.choices) || question.choices.length !== 4) {
      throw new Error(`La question ${question.id} doit avoir exactement 4 choix.`);
    }

    if (!Number.isInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex > 3) {
      throw new Error(`La question ${question.id} a un answerIndex invalide.`);
    }
  }

  return rawQuestions.slice();
}

function buildDeck(questions, questionCount) {
  const max = questionCount === "all" ? questions.length : Number(questionCount);
  return shuffle(questions).slice(0, max).map(prepareQuestion);
}

function prepareQuestion(question) {
  const shuffledChoices = shuffle(
    question.choices.map((text, originalIndex) => ({
      text,
      originalIndex
    }))
  );

  return {
    ...question,
    choices: shuffledChoices.map((choice) => choice.text),
    answerIndex: shuffledChoices.findIndex((choice) => choice.originalIndex === question.answerIndex),
    theme: getThemeForCategory(question.category)
  };
}

function buildBonusQuestion(game) {
  const players = Array.from(game.players.values());
  return {
    id: BONUS_QUESTION_ID,
    type: "bonus",
    category: "Question bonus",
    difficulty: "vote final",
    question: BONUS_QUESTION_TEXT,
    choices: players.map((player) => player.name),
    choicePlayerTokens: players.map((player) => player.token),
    answerIndex: null,
    winningAnswerIndexes: [],
    explanation: BONUS_QUESTION_EXPLANATION,
    theme: getThemeForCategory(BONUS_THEME_CATEGORY)
  };
}

function isCurrentQuestionBonus(game) {
  const currentQuestion = getCurrentQuestion(game);
  return Boolean(currentQuestion && currentQuestion.type === "bonus");
}

function applyScoring(game) {
  if (game.currentScored) {
    return;
  }

  const currentQuestion = getCurrentQuestion(game);
  if (!currentQuestion) {
    return;
  }

  if (currentQuestion.type === "bonus") {
    applyBonusScoring(game, currentQuestion);
    game.currentScored = true;
    return;
  }

  const firstCorrectToken = getFirstCorrectToken(game, currentQuestion);

  for (const player of game.players.values()) {
    const answer = game.currentAnswers.get(player.token);
    const isCorrect = Boolean(answer && answer.answerIndex === currentQuestion.answerIndex);
    const speedBonus = Boolean(isCorrect && player.token === firstCorrectToken);
    const points = isCorrect ? 1 + (speedBonus ? 1 : 0) : 0;

    player.lastAnswerCorrect = isCorrect;
    player.lastAnswerPoints = points;
    player.lastSpeedBonus = speedBonus;
    player.lastBonusAwarded = false;

    if (isCorrect) {
      player.score += points;
      player.correctCount += 1;
      if (speedBonus) {
        player.speedBonusCount = (player.speedBonusCount || 0) + 1;
      }
    }
  }

  game.currentScored = true;
}

function getFirstCorrectToken(game, currentQuestion) {
  let firstCorrect = null;

  for (const [token, answer] of game.currentAnswers.entries()) {
    if (answer.answerIndex !== currentQuestion.answerIndex) {
      continue;
    }
    if (!firstCorrect || answer.answeredAt < firstCorrect.answeredAt) {
      firstCorrect = { token, answeredAt: answer.answeredAt };
    }
  }

  return firstCorrect ? firstCorrect.token : null;
}

function applyBonusScoring(game, currentQuestion) {
  const counts = Array(currentQuestion.choices.length).fill(0);

  for (const player of game.players.values()) {
    player.lastAnswerCorrect = null;
    player.lastAnswerPoints = 0;
    player.lastSpeedBonus = false;
    player.lastBonusAwarded = false;
  }

  for (const answer of game.currentAnswers.values()) {
    if (answer.answerIndex >= 0 && answer.answerIndex < counts.length) {
      counts[answer.answerIndex] += 1;
    }
  }

  const maxVotes = Math.max(0, ...counts);
  const winningAnswerIndexes = maxVotes > 0
    ? counts.flatMap((count, index) => (count === maxVotes ? [index] : []))
    : [];

  currentQuestion.winningAnswerIndexes = winningAnswerIndexes;
  currentQuestion.answerIndex = winningAnswerIndexes.length === 1 ? winningAnswerIndexes[0] : null;

  for (const index of winningAnswerIndexes) {
    const token = currentQuestion.choicePlayerTokens[index];
    const winner = game.players.get(token);
    if (!winner) {
      continue;
    }
    winner.score += 2;
    winner.lastAnswerPoints = 2;
    winner.lastBonusAwarded = true;
  }
}

function resetRoundAnswers(game) {
  game.currentAnswers.clear();
  game.currentScored = false;
  game.questionStartedAt = Date.now();
  game.questionDeadlineAt = game.questionStartedAt + (game.settings.questionDurationMs || DEFAULT_QUESTION_DURATION_MS);

  for (const player of game.players.values()) {
    player.hasAnswered = false;
    player.selectedAnswerIndex = null;
    player.lastAnswerCorrect = null;
    player.lastAnswerPoints = 0;
    player.lastSpeedBonus = false;
    player.lastBonusAwarded = false;
  }
}

function allPlayersAnswered(game) {
  return game.players.size > 0 && game.currentAnswers.size >= game.players.size;
}

function isQuestionExpired(game, now = Date.now()) {
  return Boolean(game.questionDeadlineAt && now >= game.questionDeadlineAt);
}

function canRevealQuestion(game) {
  return game.status === "question" && (allPlayersAnswered(game) || isQuestionExpired(game));
}

function getQuestionTimeRemainingMs(game, now = Date.now()) {
  if (game.status !== "question" || !game.questionDeadlineAt) {
    return 0;
  }
  return Math.max(0, game.questionDeadlineAt - now);
}

function getCurrentQuestion(game) {
  return game.deck[game.currentQuestionIndex] || null;
}

function sanitizeQuestion(question, includeAnswer = false) {
  const sanitized = {
    id: question.id,
    category: question.category,
    difficulty: question.difficulty,
    question: question.question,
    choices: question.choices,
    theme: question.theme
  };

  if (question.type) {
    sanitized.type = question.type;
  }

  if (includeAnswer) {
    sanitized.answerIndex = question.answerIndex;
    sanitized.answerText = question.answerIndex === null ? null : question.choices[question.answerIndex];
    sanitized.explanation = question.explanation;
    if (question.type === "bonus") {
      sanitized.winningAnswerIndexes = question.winningAnswerIndexes || [];
      sanitized.winningAnswerTexts = sanitized.winningAnswerIndexes.map((index) => question.choices[index]);
    }
  }

  return sanitized;
}

function getPlayers(game) {
  return Array.from(game.players.values()).map(publicPlayer);
}

function publicPlayer(player) {
  return {
    token: player.token,
    name: player.name,
    score: player.score,
    correctCount: player.correctCount,
    speedBonusCount: player.speedBonusCount || 0,
    connected: Boolean(player.connected),
    hasAnswered: Boolean(player.hasAnswered),
    selectedAnswerIndex: player.selectedAnswerIndex,
    lastAnswerCorrect: player.lastAnswerCorrect,
    lastAnswerPoints: player.lastAnswerPoints || 0,
    lastSpeedBonus: Boolean(player.lastSpeedBonus),
    lastBonusAwarded: Boolean(player.lastBonusAwarded)
  };
}

function getLeaderboard(game) {
  return getPlayers(game)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.speedBonusCount - a.speedBonusCount ||
        b.correctCount - a.correctCount ||
        a.name.localeCompare(b.name)
    )
    .map((player, index) => ({
      ...player,
      rank: index + 1
    }));
}

function getAnswerDistribution(game) {
  const currentQuestion = getCurrentQuestion(game);
  if (!currentQuestion) {
    return [];
  }

  const counts = Array(currentQuestion.choices.length).fill(0);
  for (const answer of game.currentAnswers.values()) {
    if (answer.answerIndex >= 0 && answer.answerIndex < counts.length) {
      counts[answer.answerIndex] += 1;
    }
  }

  const includeResults = game.status === "revealed" || game.status === "finished";
  const winningAnswerIndexes = new Set(currentQuestion.winningAnswerIndexes || []);

  return currentQuestion.choices.map((choice, index) => ({
    choice,
    index,
    count: counts[index],
    correct: includeResults
      ? currentQuestion.type === "bonus"
        ? winningAnswerIndexes.has(index)
        : index === currentQuestion.answerIndex
      : null
  }));
}

function buildAnswerReveal(game, player, currentQuestion) {
  if (!player || !currentQuestion || (game.status !== "revealed" && game.status !== "finished")) {
    return null;
  }

  if (currentQuestion.type === "bonus") {
    const winningAnswerIndexes = currentQuestion.winningAnswerIndexes || [];
    return {
      type: "bonus",
      selectedAnswerIndex: player.selectedAnswerIndex,
      selectedAnswerText:
        player.selectedAnswerIndex === null ? null : currentQuestion.choices[player.selectedAnswerIndex],
      winningAnswerIndexes,
      winningAnswerTexts: winningAnswerIndexes.map((index) => currentQuestion.choices[index]),
      explanation: currentQuestion.explanation,
      pointsEarned: player.lastAnswerPoints || 0,
      bonusAwarded: Boolean(player.lastBonusAwarded)
    };
  }

  return {
    selectedAnswerIndex: player.selectedAnswerIndex,
    correctAnswerIndex: currentQuestion.answerIndex,
    correctAnswerText: currentQuestion.choices[currentQuestion.answerIndex],
    explanation: currentQuestion.explanation,
    wasCorrect: player.lastAnswerCorrect,
    pointsEarned: player.lastAnswerPoints || 0,
    speedBonus: Boolean(player.lastSpeedBonus)
  };
}

function parseQuestionCount(value) {
  if (value === "all") {
    return "all";
  }

  const parsed = Number(value);
  return VALID_COUNTS.has(parsed) ? parsed : DEFAULT_QUESTION_COUNT;
}

function parseQuestionDurationMs(value) {
  const parsed = Number(value);
  return VALID_QUESTION_DURATIONS_MS.has(parsed) ? parsed : DEFAULT_QUESTION_DURATION_MS;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizePlayerName(name) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 24) || "Sans pseudo";
}

function requirePlayer(game, token) {
  const player = game.players.get(token);
  if (!player) {
    throw new Error("Joueur introuvable.");
  }
  return player;
}

function createUniqueCode(games) {
  let code = "";
  do {
    code = String(crypto.randomInt(1000, 10000));
  } while (games.has(code));
  return code;
}

function createPlayerToken() {
  return crypto.randomBytes(12).toString("hex");
}

function shuffle(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(0, index + 1);
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

module.exports = {
  createGameStore,
  validateQuestions
};
