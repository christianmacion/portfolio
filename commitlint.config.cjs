/**
 * commitlint.config.cjs — Conventional Commits config.
 *
 * Types accepted: feat, fix, chore, refactor, perf, test, docs, build, ci, style, revert.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'refactor',
        'perf',
        'test',
        'docs',
        'build',
        'ci',
        'style',
        'revert',
      ],
    ],
    'subject-max-length': [2, 'always', 100],
  },
};