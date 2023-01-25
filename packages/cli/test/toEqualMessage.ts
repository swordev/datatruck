import { expect } from "vitest";

expect.extend({
  toEqualMessage(received, expected, custom) {
    let pass = true;
    let message = "";
    try {
      expect(received).toEqual(expected);
    } catch (e) {
      pass = false;
      message = `${e}\nMessage: ${custom}`;
    }
    return {
      pass,
      message: () => message,
      expected,
      received,
    };
  },
});

interface CustomMatchers<R = unknown> {
  toEqualMessage(a: unknown, b: string): R;
}

declare global {
  namespace Vi {
    interface Assertion extends CustomMatchers {}
    interface AsymmetricMatchersContaining extends CustomMatchers {}
  }
}

export {};
