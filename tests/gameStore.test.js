const assert = require("node:assert/strict");
const crypto = require("crypto");
const test = require("node:test");
const { createGameStore } = require("../src/gameStore");

const questions = [
  {
    id: "q1",
    category: "Pop culture déglinguée",
    difficulty: "simple",
    question: "Question 1 ?",
    choices: ["A", "B", "C", "D"],
    answerIndex: 2,
    explanation: "Parce que C."
  },
  {
    id: "q2",
    category: "Internet, memes & numérique",
    difficulty: "simple",
    question: "Question 2 ?",
    choices: ["A", "B", "C", "D"],
    answerIndex: 0,
    explanation: "Parce que A."
  }
];

test("starting a game shuffles question order and answer choices", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const originalRandomInt = crypto.randomInt;

  try {
    crypto.randomInt = (min) => min;
    store.startGame(game.code, { questionCount: "all" });
  } finally {
    crypto.randomInt = originalRandomInt;
  }

  assert.notDeepEqual(
    game.deck.slice(0, questions.length).map((question) => question.id),
    questions.map((question) => question.id)
  );

  const sourceQuestion = questions[0];
  const preparedQuestion = game.deck.find((question) => question.id === sourceQuestion.id);
  const correctAnswerText = sourceQuestion.choices[sourceQuestion.answerIndex];

  assert.notDeepEqual(preparedQuestion.choices, sourceQuestion.choices);
  assert.equal(preparedQuestion.choices[preparedQuestion.answerIndex], correctAnswerText);
});

test("game flow hides answers until reveal and scores once", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const joined = store.joinPlayer(game.code, "Thomas", null, "socket-1");

  store.startGame(game.code, { questionCount: "all" });
  let playerState = store.getPlayerState(game.code, joined.player.token);
  assert.equal(playerState.currentQuestion.answerIndex, undefined);

  const hostState = store.getHostState(game.code);
  const sourceQuestion = questions.find((question) => question.id === hostState.currentQuestion.id);
  const correctAnswerText = sourceQuestion.choices[sourceQuestion.answerIndex];
  const correctIndex = hostState.currentQuestion.choices.indexOf(correctAnswerText);

  store.submitAnswer(game.code, joined.player.token, correctIndex);
  store.revealAnswer(game.code);
  store.revealAnswer(game.code);

  playerState = store.getPlayerState(game.code, joined.player.token);
  assert.equal(playerState.answerReveal.wasCorrect, true);
  assert.equal(playerState.answerReveal.speedBonus, true);
  assert.equal(playerState.answerReveal.pointsEarned, 2);
  assert.equal(playerState.me.score, 2);
  assert.equal(playerState.currentQuestion.answerText, correctAnswerText);
});

test("a player can change answer while the timer is running", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const joined = store.joinPlayer(game.code, "Alex", null, "socket-1");

  store.startGame(game.code, { questionCount: 10 });
  store.submitAnswer(game.code, joined.player.token, 0);
  store.submitAnswer(game.code, joined.player.token, 1);

  const playerState = store.getPlayerState(game.code, joined.player.token);
  assert.equal(playerState.me.hasAnswered, true);
  assert.equal(playerState.me.selectedAnswerIndex, 1);
  assert.equal(playerState.responsesCount, 1);
});

test("starting a game accepts lobby question count and timer settings", () => {
  const store = createGameStore(questions);

  for (const questionCount of [10, 20, 30, 40]) {
    const game = store.createGame(`host-${questionCount}`);
    const player = store.joinPlayer(game.code, "Alex", null, `socket-${questionCount}`).player;

    store.startGame(game.code, { questionCount, questionDurationMs: 15000 });

    assert.equal(game.settings.questionCount, questionCount);
    assert.equal(game.settings.questionDurationMs, 15000);
    assert.equal(game.questionDeadlineAt - game.questionStartedAt, 15000);
    assert.equal(store.getHostState(game.code).questionDurationMs, 15000);
    assert.equal(store.getPlayerState(game.code, player.token).questionDurationMs, 15000);
  }
});

test("a player cannot change answer after the timer has ended", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const joined = store.joinPlayer(game.code, "Alex", null, "socket-1");

  store.startGame(game.code, { questionCount: 10 });
  store.submitAnswer(game.code, joined.player.token, 0);
  game.questionDeadlineAt = Date.now() - 1;

  assert.throws(() => store.submitAnswer(game.code, joined.player.token, 1), /temps/);
});

test("the first correct answer gets the speed bonus", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const thomas = store.joinPlayer(game.code, "Thomas", null, "socket-1").player;
  const alex = store.joinPlayer(game.code, "Alex", null, "socket-2").player;
  const sam = store.joinPlayer(game.code, "Sam", null, "socket-3").player;

  store.startGame(game.code, { questionCount: 10 });
  const hostState = store.getHostState(game.code);
  const sourceQuestion = questions.find((question) => question.id === hostState.currentQuestion.id);
  const correctIndex = hostState.currentQuestion.choices.indexOf(sourceQuestion.choices[sourceQuestion.answerIndex]);
  const wrongIndex = hostState.currentQuestion.choices.findIndex((_choice, index) => index !== correctIndex);

  store.submitAnswer(game.code, thomas.token, wrongIndex);
  store.submitAnswer(game.code, alex.token, correctIndex);
  store.submitAnswer(game.code, sam.token, correctIndex);
  store.revealAnswer(game.code);

  const leaderboard = store.getHostState(game.code).leaderboard;
  assert.equal(leaderboard.find((player) => player.name === "Alex").score, 2);
  assert.equal(leaderboard.find((player) => player.name === "Alex").speedBonusCount, 1);
  assert.equal(leaderboard.find((player) => player.name === "Sam").score, 1);
  assert.equal(leaderboard.find((player) => player.name === "Sam").speedBonusCount, 0);
  assert.equal(leaderboard.find((player) => player.name === "Thomas").score, 0);
});

test("the final bonus question uses player names and awards the most voted player", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const thomas = store.joinPlayer(game.code, "Thomas", null, "socket-1").player;
  const alex = store.joinPlayer(game.code, "Alex", null, "socket-2").player;
  const sam = store.joinPlayer(game.code, "Sam", null, "socket-3").player;

  store.startGame(game.code, { questionCount: "all" });
  for (let index = 0; index < questions.length; index += 1) {
    game.questionDeadlineAt = Date.now() - 1;
    store.revealAnswer(game.code);
    store.nextQuestion(game.code);
  }

  let hostState = store.getHostState(game.code);
  assert.equal(hostState.currentQuestion.type, "bonus");
  assert.equal(hostState.currentQuestionNumber, 3);
  assert.equal(hostState.totalQuestions, 3);
  assert.deepEqual(hostState.currentQuestion.choices, ["Thomas", "Alex", "Sam"]);

  const thomasIndex = hostState.currentQuestion.choices.indexOf("Thomas");
  const alexIndex = hostState.currentQuestion.choices.indexOf("Alex");
  store.submitAnswer(game.code, thomas.token, alexIndex);
  store.submitAnswer(game.code, alex.token, alexIndex);
  store.submitAnswer(game.code, sam.token, thomasIndex);
  store.revealAnswer(game.code);

  hostState = store.getHostState(game.code);
  assert.equal(hostState.leaderboard.find((player) => player.name === "Alex").score, 2);
  assert.equal(hostState.leaderboard.find((player) => player.name === "Thomas").score, 0);
  assert.equal(hostState.leaderboard.find((player) => player.name === "Sam").score, 0);
  assert.equal(hostState.answerDistribution.find((answer) => answer.choice === "Alex").correct, true);

  const alexState = store.getPlayerState(game.code, alex.token);
  assert.equal(alexState.answerReveal.type, "bonus");
  assert.equal(alexState.answerReveal.bonusAwarded, true);
  assert.equal(alexState.answerReveal.pointsEarned, 2);
});

test("resetting a game issues a new code and retires the old one", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const originalCode = game.code;
  const player = store.joinPlayer(game.code, "Thomas", null, "socket-1").player;

  store.startGame(game.code, { questionCount: "all" });
  store.submitAnswer(game.code, player.token, 0);
  player.speedBonusCount = 3;

  const resetGame = store.resetGame(originalCode);

  assert.notEqual(resetGame.code, originalCode);
  assert.equal(resetGame.status, "lobby");
  assert.equal(store.getGame(originalCode), null);
  assert.equal(store.getGame(resetGame.code), resetGame);

  const resetPlayer = resetGame.players.get(player.token);
  assert.equal(resetPlayer.score, 0);
  assert.equal(resetPlayer.speedBonusCount, 0);
  assert.equal(resetPlayer.hasAnswered, false);
});
