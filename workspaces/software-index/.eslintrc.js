const baseConfig = require('../../.eslintrc.cjs');

module.exports = {
  ...baseConfig,
  overrides: [
    ...baseConfig.overrides,
    {
      files: ['**/*.mjs'],
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  ],
};
