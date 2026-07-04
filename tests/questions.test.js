const assert = require("node:assert/strict");
const test = require("node:test");
const questions = require("../data/questions.json");
const { validateQuestions } = require("../src/gameStore");

test("question bank has the expected MVP shape", () => {
  assert.equal(questions.length, 60);
  assert.doesNotThrow(() => validateQuestions(questions));

  const categories = new Map();
  const ids = new Set();

  for (const question of questions) {
    ids.add(question.id);
    categories.set(question.category, (categories.get(question.category) || 0) + 1);
    assert.equal(question.choices.length, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex <= 3);
  }

  assert.equal(ids.size, questions.length);
  assert.equal(categories.size, 6);
  assert.deepEqual([...categories.values()].sort((a, b) => a - b), [10, 10, 10, 10, 10, 10]);
});
