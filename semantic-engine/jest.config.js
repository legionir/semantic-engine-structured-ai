module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Several suites share the on-disk test fixture and spawn child processes;
  // parallel workers contend for them and make runs flaky (and slower).
  maxWorkers: 1,
  roots: ['<rootDir>/src'],
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/test-fixture'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  /*
  | تا فاز ۱۳ اینجا یک moduleNameMapper برای 'vscode' بود که به یک mock
  | دستی اشاره می‌کرد. هیچ فایلی دیگر vscode را import نمی‌کند
  | (src/host/vscodeCoupling.test.ts این را نگه می‌دارد)، پس هم mock و
  | هم نگاشت حذف شدند.
  */
};
