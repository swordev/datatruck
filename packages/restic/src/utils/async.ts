import { duration } from "@datatruck/cli/utils/date.js";

export function createRunner(rutine: () => any) {
  return {
    start: async (
      cb: (data: { error: Error | undefined; duration: string }) => any,
    ) => {
      const now = Date.now();
      let error: Error | undefined;
      try {
        await rutine();
      } catch (inError) {
        error = inError as Error;
      }
      try {
        await cb({
          duration: duration(Date.now() - now),
          error,
        });
      } finally {
        if (error) console.error(error, "\n");
      }
    },
  };
}
