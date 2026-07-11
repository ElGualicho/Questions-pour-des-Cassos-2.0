import QRCode from "qrcode";
import questions from "../data/questions.json" with { type: "json" };

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

const themesByCategory = {
  "Pop culture déglinguée": {
    id: "pop",
    label: "Pop culture déglinguée",
    image: "/assets/themes/theme-pop-culture-deglinguee.png",
    accent: "#d9bd28",
    ink: "#101010"
  },
  "Alcool, drogues & fictions": {
    id: "tox",
    label: "Alcool, drogues & fictions",
    image: "/assets/themes/theme-alcool-drogues-fictions.png",
    accent: "#e62b72",
    ink: "#ffffff"
  },
  "Corps, cul & malaise poli": {
    id: "body",
    label: "Corps, cul & malaise poli",
    image: "/assets/themes/theme-corps-cul-malaise-poli.png",
    accent: "#63ce3d",
    ink: "#101010"
  },
  "Mort, musique & destins claqués": {
    id: "death",
    label: "Mort, musique & destins claqués",
    image: "/assets/themes/theme-mort-musique-destins-claques.png",
    accent: "#365fd7",
    ink: "#ffffff"
  },
  "Culture générale chelou": {
    id: "weird",
    label: "Culture générale chelou",
    image: "/assets/themes/theme-culture-generale-chelou.png",
    accent: "#f2f2ec",
    ink: "#101010"
  },
  "Internet, memes & numérique": {
    id: "net",
    label: "Internet, memes & numérique",
    image: "/assets/themes/theme-internet-memes-numerique.png",
    accent: "#62cbea",
    ink: "#101010"
  }
};

const fallbackTheme = themesByCategory["Pop culture déglinguée"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("WebSocket attendu.", { status: 426 });
      }
      const id = env.GAME_ROOM.idFromName("global-room");
      return env.GAME_ROOM.get(id).fetch(request);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, questions: questions.length, runtime: "cloudflare-worker" });
    }

    const qrMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/qr\.svg$/);
    if (qrMatch) {
      const code = decodeURIComponent(qrMatch[1]).trim().toUpperCase();
      const joinUrl = `${url.origin}${joinPath(code)}`;
      const svg = await QRCode.toString(joinUrl, {
        type: "svg",
        margin: 0,
        width: 280,
        color: { dark: "#000000", light: "#00000000" }
      });
      return new Response(svg, {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8" }
      });
    }

    if (url.pathname.startsWith("/join/")) {
      const code = url.pathname.split("/").pop();
      return Response.redirect(`${url.origin}/play?code=${encodeURIComponent(code)}`, 302);
    }

    if (url.pathname === "/" || url.pathname === "/host") {
      const hostRequest = new Request(new URL("/host.html", url.origin), request);
      return env.ASSETS.fetch(hostRequest);
    }

    if (url.pathname === "/play") {
      const playerRequest = new Request(new URL("/player.html", url.origin), request);
      return env.ASSETS.fetch(playerRequest);
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.games = new Map();
    this.sessions = new Map();
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const session = {
      id: crypto.randomUUID(),
      role: null,
      code: null,
      token: null
    };

    this.sessions.set(server, session);

    server.addEventListener("message", (event) => {
      this.handleMessage(server, event.data);
    });

    server.addEventListener("close", () => {
      this.handleClose(server);
    });

    server.addEventListener("error", () => {
      this.handleClose(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  handleMessage(ws, rawMessage) {
    const session = this.sessions.get(ws);
    let message;

    try {
      message = JSON.parse(rawMessage);
    } catch (_error) {
      this.sendReply(ws, null, { ok: false, error: "Message invalide." });
      return;
    }

    const { event, payload = {}, requestId } = message;

    try {
      const response = this.routeEvent(ws, session, event, payload);
      this.sendReply(ws, requestId, { ok: true, ...response });
    } catch (error) {
      this.sendReply(ws, requestId, { ok: false, error: error.message });
    }
  }

  routeEvent(ws, session, event, payload) {
    if (event === "host:createGame") {
      const game = this.createGame(session.id);
      session.role = "host";
      session.code = game.code;
      game.hostSocketId = session.id;
      this.emitGame(game);
      return { state: this.getHostState(game), joinUrl: joinPath(game.code) };
    }

    if (event === "host:resumeGame") {
      const game = this.requireGame(payload.code);
      session.role = "host";
      session.code = game.code;
      game.hostSocketId = session.id;
      game.hostConnected = true;
      this.emitGame(game);
      return { state: this.getHostState(game), joinUrl: joinPath(game.code) };
    }

    if (event === "host:startGame") {
      const game = this.startGame(payload.code, payload);
      this.emitGame(game);
      return { state: this.getHostState(game) };
    }

    if (event === "host:nextQuestion") {
      const game = this.nextQuestion(payload.code);
      this.emitGame(game);
      return { state: this.getHostState(game) };
    }

    if (event === "host:revealAnswer") {
      const game = this.revealAnswer(payload.code);
      this.emitGame(game);
      return { state: this.getHostState(game) };
    }

    if (event === "host:resetGame") {
      const game = this.resetGame(payload.code);
      this.emitGame(game);
      return { state: this.getHostState(game) };
    }

    if (event === "host:removePlayer") {
      const game = this.removePlayer(payload.code, payload.token);
      this.emitGame(game);
      return { state: this.getHostState(game) };
    }

    if (event === "player:joinGame") {
      const { game, player } = this.joinPlayer(payload.code, payload.name, payload.token, session.id);
      session.role = "player";
      session.code = game.code;
      session.token = player.token;
      this.emitGame(game);
      return { token: player.token, state: this.getPlayerState(game, player.token) };
    }

    if (event === "player:submitAnswer") {
      const game = this.submitAnswer(payload.code, payload.token, payload.answerIndex);
      this.emitGame(game);
      return { state: this.getPlayerState(game, payload.token) };
    }

    throw new Error("Événement inconnu.");
  }

  handleClose(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (!session || !session.code) {
      return;
    }

    const game = this.games.get(session.code);
    if (!game) {
      return;
    }

    if (session.role === "host" && game.hostSocketId === session.id) {
      game.hostConnected = false;
    }

    if (session.role === "player" && session.token) {
      const player = game.players.get(session.token);
      if (player) {
        player.connected = false;
      }
    }

    this.emitGame(game);
  }

  createGame(hostSocketId) {
    const code = createUniqueCode(this.games);
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
    this.games.set(code, game);
    return game;
  }

  requireGame(code) {
    const game = this.games.get(normalizeCode(code));
    if (!game) {
      throw new Error("Partie introuvable.");
    }
    return game;
  }

  startGame(code, settings = {}) {
    const game = this.requireGame(code);
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

  nextQuestion(code) {
    const game = this.requireGame(code);
    if (!game.deck.length) {
      return this.startGame(code, game.settings);
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

  revealAnswer(code) {
    const game = this.requireGame(code);
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

  resetGame(code) {
    const game = this.requireGame(code);
    const previousCode = game.code;
    const newCode = createUniqueCode(this.games);

    this.games.delete(previousCode);
    game.code = newCode;
    this.games.set(newCode, game);

    for (const trackedSession of this.sessions.values()) {
      if (trackedSession.code === previousCode) {
        trackedSession.code = newCode;
      }
    }

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
      player.hasAnswered = false;
      player.selectedAnswerIndex = null;
      player.lastAnswerCorrect = null;
      player.lastAnswerPoints = 0;
      player.lastSpeedBonus = false;
      player.lastBonusAwarded = false;
    }
    return game;
  }

  joinPlayer(code, name, token, socketId) {
    const game = this.requireGame(code);
    const playerToken = token && game.players.has(token) ? token : crypto.randomUUID();
    const player = game.players.get(playerToken) || {
      token: playerToken,
      score: 0,
      correctCount: 0,
      joinedAt: Date.now(),
      hasAnswered: false,
      selectedAnswerIndex: null,
      lastAnswerCorrect: null,
      lastAnswerPoints: 0,
      lastSpeedBonus: false,
      lastBonusAwarded: false
    };

    player.name = normalizePlayerName(name);
    player.socketId = socketId;
    player.connected = true;
    game.players.set(playerToken, player);
    return { game, player };
  }

  submitAnswer(code, token, answerIndex) {
    const game = this.requireGame(code);
    const player = game.players.get(token);
    const currentQuestion = getCurrentQuestion(game);

    if (!player) {
      throw new Error("Joueur introuvable.");
    }
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
    game.currentAnswers.set(player.token, { answerIndex: parsedAnswer, answeredAt: Date.now() });
    return game;
  }

  removePlayer(code, token) {
    const game = this.requireGame(code);
    game.players.delete(token);
    game.currentAnswers.delete(token);
    return game;
  }

  getHostState(input) {
    const game = typeof input === "string" ? this.requireGame(input) : input;
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

  getPlayerState(input, token) {
    const game = typeof input === "string" ? this.requireGame(input) : input;
    const player = token ? game.players.get(token) : null;
    const currentQuestion = getCurrentQuestion(game);
    const includeAnswer = game.status === "revealed" || game.status === "finished";

    return {
      code: game.code,
      status: game.status,
      me: player ? publicPlayer(player) : null,
      players: getPlayers(game).map(({ token: _token, ...publicFields }) => publicFields),
      currentQuestion: currentQuestion ? sanitizeQuestion(currentQuestion, includeAnswer) : null,
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

  emitGame(game) {
    const hostState = this.getHostState(game);
    for (const [ws, session] of this.sessions.entries()) {
      if (session.role === "host" && session.code === game.code) {
        this.sendEvent(ws, "host:state", { state: hostState, joinUrl: joinPath(game.code) });
      }
      if (session.role === "player" && session.code === game.code && session.token) {
        this.sendEvent(ws, "player:state", { state: this.getPlayerState(game, session.token) });
      }
    }
  }

  sendReply(ws, requestId, response) {
    if (!requestId || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ requestId, response }));
  }

  sendEvent(ws, event, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ event, payload }));
  }
}

function buildDeck(rawQuestions, questionCount) {
  const max = questionCount === "all" ? rawQuestions.length : Number(questionCount);
  return shuffle(rawQuestions).slice(0, max).map(prepareQuestion);
}

function prepareQuestion(question) {
  const shuffledChoices = shuffle(question.choices.map((text, originalIndex) => ({ text, originalIndex })));
  return {
    ...question,
    choices: shuffledChoices.map((choice) => choice.text),
    answerIndex: shuffledChoices.findIndex((choice) => choice.originalIndex === question.answerIndex),
    theme: themesByCategory[question.category] || fallbackTheme
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
    theme: themesByCategory[BONUS_THEME_CATEGORY] || fallbackTheme
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
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.name.localeCompare(b.name))
    .map((player, index) => ({ ...player, rank: index + 1 }));
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

function createUniqueCode(games) {
  let code = "";
  do {
    code = String(randomInt(1000, 10000));
  } while (games.has(code));
  return code;
}

function randomInt(min, max) {
  const range = max - min;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return min + (bytes[0] % range);
}

function shuffle(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(0, index + 1);
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function joinPath(code) {
  return `/play?code=${encodeURIComponent(code)}`;
}

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}
