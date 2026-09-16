module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/syncro-kafka-events/__tests__/setup.js'],
  collectCoverageFrom: [
    'syncro-kafka-events/*.js',
    '!syncro-kafka-events/index.test.js'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  }
};
