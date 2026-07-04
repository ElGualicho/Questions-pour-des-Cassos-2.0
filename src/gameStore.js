const crypto = require("crypto");
const { getThemeForCategory } = require("./themes");

const DEFAULT_QUESTION_COUNT = 10;
const VALID_COUNTS = new Set([10, 20, "all"]);

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
      settings: {
        questionCount: DEFAULT_QUESTION_COUNT
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
    game.settings.questionCount = questionCount;
    game.deck = buildDeck(questions, questionCount);
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
      return game;
    }

    game.currentQuestionIndex += 1;
    resetRoundAnswers(game);
    game.status = "question";
    return game;
  }

  function revealAnswer(code) {
    const game = requireGame(code);
    if (!getCurrentQuestion(game)) {
      throw new Error("Aucune question active.");
    }

    applyScoring(game);
    game.status = "revealed";
    return game;
  }

  function resetGame(code) {
    const game = requireGame(code);
    game.status = "lobby";
    game.deck = [];
    game.currentQuestionIndex = -1;
    game.currentAnswers.clear();
    game.currentScored = false;

    for (const player of game.players.values()) {
      player.score = 0;
      player.correctCount = 0;
      player.hasAnswered = false;
      player.selectedAnswerIndex = null;
      player.lastAnswerCorrect = null;
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
      joinedAt: Date.now(),
      hasAnswered: false,
      selectedAnswerIndex: null,
      lastAnswerCorrect: null
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

    if (player.hasAnswered) {
      throw new Error("Réponse déjà envoyée.");
    }

    const parsedAnswer = Number(answerIndex);
    if (!Number.isInteger(parsedAnswer) || parsedAnswer < 0 || parsedAnswer > 3) {
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
      allAnswered: game.players.size > 0 && game.currentAnswers.size >= game.players.size,
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

function applyScoring(game) {
  if (game.currentScored) {
    return;
  }

  const currentQuestion = getCurrentQuestion(game);
  if (!currentQuestion) {
    return;
  }

  for (const player of game.players.values()) {
    const answer = game.currentAnswers.get(player.token);
    const isCorrect = Boolean(answer && answer.answerIndex === currentQuestion.answerIndex);
    player.lastAnswerCorrect = isCorrect;

    if (isCorrect) {
      player.score += 1;
      player.correctCount += 1;
    }
  }

  game.currentScored = true;
}

function resetRoundAnswers(game) {
  game.currentAnswers.clear();
  game.currentScored = false;

  for (const player of game.players.values()) {
    player.hasAnswered = false;
    player.selectedAnswerIndex = null;
    player.lastAnswerCorrect = null;
  }
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

  if (includeAnswer) {
    sanitized.answerIndex = question.answerIndex;
    sanitized.answerText = question.choices[question.answerIndex];
    sanitized.explanation = question.explanation;
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
    connected: Boolean(player.connected),
    hasAnswered: Boolean(player.hasAnswered),
    selectedAnswerIndex: player.selectedAnswerIndex,
    lastAnswerCorrect: player.lastAnswerCorrect
  };
}

function getLeaderboard(game) {
  return getPlayers(game)
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.name.localeCompare(b.name))
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

  const counts = [0, 0, 0, 0];
  for (const answer of game.currentAnswers.values()) {
    counts[answer.answerIndex] += 1;
  }

  return currentQuestion.choices.map((choice, index) => ({
    choice,
    index,
    count: counts[index],
    correct: game.status === "revealed" || game.status === "finished" ? index === currentQuestion.answerIndex : null
  }));
}

function buildAnswerReveal(game, player, currentQuestion) {
  if (!player || !currentQuestion || game.status !== "revealed") {
    return null;
  }

  return {
    selectedAnswerIndex: player.selectedAnswerIndex,
    correctAnswerIndex: currentQuestion.answerIndex,
    correctAnswerText: currentQuestion.choices[currentQuestion.answerIndex],
    explanation: currentQuestion.explanation,
    wasCorrect: player.lastAnswerCorrect
  };
}

function parseQuestionCount(value) {
  if (value === "all") {
    return "all";
  }

  const parsed = Number(value);
  return VALID_COUNTS.has(parsed) ? parsed : DEFAULT_QUESTION_COUNT;
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
