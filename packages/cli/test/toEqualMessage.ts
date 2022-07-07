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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface Matchers<R> {
      toEqualMessage(a: unknown, b: string): R;
    }
  }
}

export {};
