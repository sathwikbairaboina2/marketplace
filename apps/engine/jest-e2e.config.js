module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test/e2e',
  testRegex: '.*\\.e2e\\.test\\.ts$',
  testTimeout: 60000,
};
