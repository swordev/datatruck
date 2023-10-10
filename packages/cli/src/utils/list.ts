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
  protected beforeRun: ((list: this) => any) | undefined;
  protected afterRun: ((list: this) => any) | undefined;
  constructor(options: { ctx?: Ctx; tty?: () => boolean }) {
    super([], {
      ctx: options.ctx,
      renderer: "default",
      collectErrors: "minimal",
      fallbackRendererCondition: options.tty,
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
  onBeforeRun(cb: (list: this) => any) {
    this.beforeRun = cb;
    return this;
  }
  onAfterRun(cb: (list: this) => any) {
    this.afterRun = cb;
    return this;
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
    await this.beforeRun?.(this);
    try {
      return await super.run(context);
    } finally {
      await this.afterRun?.(this);
    }
  }
}
