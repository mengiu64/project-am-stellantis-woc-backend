// jest.config.js
// Jest configuration for syncro-kafka-events tests

module.exports = {
  displayName: 'syncro-kafka-events',
  testEnvironment: 'node',
  
  // Coverage configuration
  collectCoverageFrom: [
    '**/*.js',
    '!__tests__/**',
    '!jest.config.js',
    '!node_modules/**',
    '!coverage/**'
  ],
  
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
  
  // Test patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/*.test.js'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/.git/'
  ],
  
  // Setup
  setupFilesAfterEnv: [],
  
  // Verbose output
  verbose: true,
  
  // Timeout for long-running tests
  testTimeout: 10000,
  
  // Show coverage summary
  coverageReporters: ['text', 'lcov', 'json'],
  
  // Module name mapper for aliases
  moduleNameMapper: {},
  
  // Transformations
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Global setup/teardown
  globalSetup: undefined,
  globalTeardown: undefined
};
