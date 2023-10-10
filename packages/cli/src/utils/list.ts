import { ProgressManager } from "./progress";
import {
  Listr,
  ListrContext,
  ListrGetRendererClassFromValue,
  ListrLogger,
  ListrTask,
  PRESET_TIMER,
  PRESET_TIMESTAMP,
  ProcessOutput,
} from "listr2";

export class List3Logger<
  Levels extends string = string,
> extends ListrLogger<Levels> {
  constructor() {
    super({ processOutput: new ProcessOutput(process.stderr, process.stderr) });
  }
}

export class Listr3<Ctx = ListrContext> extends Listr<
  Ctx,
  "default",
  "simple"
> {
  constructor(
    readonly $options: {
      ctx?: Ctx;
      progressManager?: ProgressManager;
      onAfterRun?: () => void;
    },
  ) {
    super([], {
      ctx: $options.ctx,
      renderer: "default",
      collectErrors: "minimal",
      ...($options.progressManager && {
        fallbackRendererCondition: () => !$options.progressManager!.tty,
      }),
      fallbackRenderer: "simple",
      fallbackRendererOptions: {
        logger: new List3Logger(),
        timestamp: PRESET_TIMESTAMP,
        timer: PRESET_TIMER,
      },
      rendererOptions: {
        logger: new List3Logger(),
        collapseSubtasks: false,
        collapseErrors: false,
        timer: PRESET_TIMER,
      },
    });
  }
  override add(
    tasks:
      | ListrTask<Ctx, ListrGetRendererClassFromValue<"default">>
      | ListrTask<Ctx, ListrGetRendererClassFromValue<"default">>[],
  ) {
    super.add(tasks);
    return this;
  }
  override async run(context?: Ctx): Promise<Ctx> {
    try {
      this.$options.progressManager?.start();
      return await super.run(context);
    } finally {
      this.$options.onAfterRun?.();
      this.$options.progressManager?.dispose();
    }
  }
}
