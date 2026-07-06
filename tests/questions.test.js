const assert = require("node:assert/strict");
const test = require("node:test");
const questions = require("../data/questions.json");
const { validateQuestions } = require("../src/gameStore");
const { themesByCategory } = require("../src/themes");

test("question bank has the expected MVP shape", () => {
  const expectedCategories = Object.keys(themesByCategory);
  assert.ok(questions.length >= expectedCategories.length * 10);
  assert.doesNotThrow(() => validateQuestions(questions));

  const categories = new Map();
  const ids = new Set();
  const answerPositions = [0, 0, 0, 0];

  for (const question of questions) {
    ids.add(question.id);
    categories.set(question.category, (categories.get(question.category) || 0) + 1);
    assert.equal(question.choices.length, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex <= 3);
    answerPositions[question.answerIndex] += 1;
  }

  assert.equal(ids.size, questions.length);
  assert.equal(categories.size, expectedCategories.length);
  for (const category of expectedCategories) {
    assert.ok(categories.get(category) >= 10, `${category} should have at least 10 questions`);
  }

  assert.ok(Math.max(...answerPositions) - Math.min(...answerPositions) <= 1);
});
