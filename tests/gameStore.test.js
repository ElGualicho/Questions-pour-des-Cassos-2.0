const assert = require("node:assert/strict");
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
  assert.equal(playerState.me.score, 1);
  assert.equal(playerState.currentQuestion.answerText, correctAnswerText);
});

test("a player cannot answer twice during the same question", () => {
  const store = createGameStore(questions);
  const game = store.createGame("host-1");
  const joined = store.joinPlayer(game.code, "Alex", null, "socket-1");

  store.startGame(game.code, { questionCount: 10 });
  store.submitAnswer(game.code, joined.player.token, 0);

  assert.throws(
    () => store.submitAnswer(game.code, joined.player.token, 1),
    /Réponse déjà envoyée/
  );
});
