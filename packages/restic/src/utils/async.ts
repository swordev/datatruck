import { duration } from "@datatruck/cli/utils/date.js";

export function createRunner(rutine: () => any) {
  return {
    start: async <R = any>(
      cb: (data: { error: Error | undefined; duration: string }) => Promise<R>,
    ): Promise<R> => {
      const now = Date.now();
      let error: Error | undefined;
      try {
        await rutine();
      } catch (inError) {
        error = inError as Error;
      }
      try {
        return await cb({
          duration: duration(Date.now() - now),
          error,
        });
      } finally {
        if (error) console.error(error, "\n");
      }
    },
  };
}

export async function safeRun<T>(
  cb: () => Promise<T>,
): Promise<{ error: Error | undefined; result: T | undefined }> {
  try {
    return {
      error: undefined,
      result: await cb(),
    };
  } catch (error) {
    return { error: error as Error, result: undefined };
  }
}
