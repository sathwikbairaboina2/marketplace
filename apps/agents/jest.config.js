module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.(test|int-test)\\.ts$',
  passWithNoTests: true,

  // Two workers, not one per core. These suites are not pure unit tests: the
  // `int-test` half boots whole Nest applications and one of them calls a local
  // model that can hold a core for a minute. Left to fan out, jest starves the
  // app boots against the model call and reports timeouts in suites that have
  // nothing wrong with them -- eight of them, on a run where every suite passed
  // when run alone.
  maxWorkers: 2,
  setupFiles: ['<rootDir>/../jest.setup.js'],
};
