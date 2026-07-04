import QRCode from "qrcode";
import questions from "../data/questions.json" with { type: "json" };

const DEFAULT_QUESTION_COUNT = 10;
const VALID_COUNTS = new Set([10, 20, "all"]);

const themesByCategory = {
  "Pop culture déglinguée": {
    id: "pop",
    label: "Pop culture déglinguée",
    image: "/assets/themes/IMG_0304.JPG",
    accent: "#d9bd28",
    ink: "#101010"
  },
  "Alcool, drogues & fictions": {
    id: "tox",
    label: "Alcool, drogues & fictions",
    image: "/assets/themes/IMG_0305.JPG",
    accent: "#e62b72",
    ink: "#ffffff"
  },
  "Corps, cul & malaise poli": {
    id: "body",
    label: "Corps, cul & malaise poli",
    image: "/assets/themes/IMG_0306.JPG",
    accent: "#63ce3d",
    ink: "#101010"
  },
  "Mort, musique & destins claqués": {
    id: "death",
    label: "Mort, musique & destins claqués",
    image: "/assets/themes/IMG_0308.JPG",
    accent: "#365fd7",
    ink: "#ffffff"
  },
  "Culture générale chelou": {
    id: "weird",
    label: "Culture générale chelou",
    image: "/assets/themes/IMG_0309.JPG",
    accent: "#f2f2ec",
    ink: "#101010"
  },
  "Internet, memes & numérique": {
    id: "net",
    label: "Internet, memes & numérique",
    image: "/assets/themes/IMG_0310.JPG",
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
      const joinUrl = `${url.origin}/join/${encodeURIComponent(code)}`;
      const svg = await QRCode.toString(joinUrl, {
        type: "svg",
        margin: 1,
        width: 280,
        color: { dark: "#111111", light: "#ffffff" }
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
      settings: { questionCount: DEFAULT_QUESTION_COUNT },
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
    game.settings.questionCount = questionCount;
    game.deck = buildDeck(questions, questionCount);
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
      return game;
    }
    game.currentQuestionIndex += 1;
    resetRoundAnswers(game);
    game.status = "question";
    return game;
  }

  revealAnswer(code) {
    const game = this.requireGame(code);
    if (!getCurrentQuestion(game)) {
      throw new Error("Aucune question active.");
    }
    applyScoring(game);
    game.status = "revealed";
    return game;
  }

  resetGame(code) {
    const game = this.requireGame(code);
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
      lastAnswerCorrect: null
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
      allAnswered: game.players.size > 0 && game.currentAnswers.size >= game.players.size,
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
    .map((player, index) => ({ ...player, rank: index + 1 }));
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
  return `/join/${encodeURIComponent(code)}`;
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
