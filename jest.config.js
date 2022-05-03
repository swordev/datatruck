module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["json", "html"],
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.jest.json",
    },
  },
  testMatch: [
    "<rootDir>/packages/*/src/**/*.test.ts",
    "<rootDir>/packages/*/test/**/*.test.ts",
  ],
};
