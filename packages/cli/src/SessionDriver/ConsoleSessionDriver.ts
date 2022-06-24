import { AppError } from "../Error/AppError";
import {
  clearCommand,
  hideCursorCommand,
  logVars,
  renderProgressBar,
  renderSpinner,
  showCursorCommand,
  truncate,
} from "../util/cli-util";
import { createChron } from "../util/date-util";
import {
  ActionEnum,
  WriteDataType,
  EntityEnum,
  ReadResultType,
  SessionDriverAbstract,
} from "./SessionDriverAbstract";
import { cyan, white, red, grey, green } from "chalk";

type BadgeType = {
  name: string;
  value: string;
  color: (input: string) => string;
};

type MessageType = {
  sessionId: number;
  level?: number;
  textPrefix?: string;
  text?: string;
  badges: BadgeType[];
  errorBadge?: BadgeType;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  progressPercent?: number | null;
  progressStep?: string | null;
  progressStepPercent?: number | null;
};

const sep = grey(`|`);

const renderBadge = (badge: BadgeType) =>
  `${badge.color(badge.name)}${grey(`:`)} ${white(badge.value)}`;

const renderBadges = (badges: BadgeType[]) =>
  badges.map(renderBadge).join(` ${sep} `);

export class ConsoleSessionDriver extends SessionDriverAbstract {
  protected lastMessage: MessageType | undefined;
  protected lastMessageText: string | undefined;
  protected prints = 0;
  protected renderInterval!: NodeJS.Timeout;
  protected rendering?: boolean;
  protected lastColumns?: number;
  protected startTime!: number;
  protected chron = createChron();

  override async onInit() {
    this.chron.start();
    this.renderInterval = setInterval(() => {
      if (this.lastMessage) this.printMessage(this.lastMessage);
    }, 100);
  }

  override async onEnd(data?: Record<string, any>) {
    clearInterval(this.renderInterval);
    if (!this.options.verbose) process.stdout.write(showCursorCommand);
    logVars({
      ...data,
      elapsed: this.chron.elapsed(true),
    });
  }

  override async onRead(): Promise<ReadResultType[]> {
    throw new AppError("Method not implemented");
  }

  protected printMessage(message: MessageType) {
    const text = this.renderMessage(message);
    if (this.options.verbose && this.lastMessageText === text) {
      return;
    }
    if (this.options.verbose) {
      process.stdout.write(`${this.renderSpinner(text)}\n`);
    } else {
      const columns = process.stdout.columns;
      const line = this.renderSpinner(text);
      const [truncatedLine, truncted] = truncate(line, columns);

      if (this.lastColumns && columns !== this.lastColumns && truncted)
        process.stdout.write(`${clearCommand}\n`);
      process.stdout.write(
        `${clearCommand}${truncatedLine}${hideCursorCommand}`
      );
      this.lastColumns = columns;
    }
    this.prints++;
    this.lastMessage = message;
    this.lastMessageText = text;
  }

  protected renderSpinner(text: string) {
    return text.replace(
      "{spinner}",
      grey(this.options.verbose ? "?" : renderSpinner(this.prints))
    );
  }

  protected renderMessage(message: MessageType) {
    const badges = renderBadges([
      ...message.badges,
      ...(message.errorBadge ? [message.errorBadge] : []),
    ]);

    const padding = "   ".repeat(message.level ?? 0);
    const haveProgressBar = typeof message.progressPercent === "number";
    const sessionId = message.sessionId.toString().padStart(2, "0");
    const parts = [
      `${padding}${message.textPrefix} [${grey(sessionId)}] ${message.text}`,
      badges,
    ];

    if (typeof message.progressPercent === "number") {
      parts.push(
        cyan(renderProgressBar(message.progressPercent ?? 0, 10)),
        `${message.progressPercent?.toFixed(2)}%`
      );
    }

    if (
      typeof message.progressCurrent === "number" ||
      typeof message.progressTotal === "number"
    ) {
      parts.push(
        `${message.progressCurrent ?? "?"}/${message.progressTotal ?? "?"}`
      );
    }

    if (typeof message.progressStep === "string")
      parts.push(message.progressStep);

    if (typeof message.progressStepPercent === "number") {
      parts.push(cyan(renderProgressBar(message.progressStepPercent ?? 0, 10)));
    }

    return parts.join(` ${sep} `);
  }

  override async onWrite(data: WriteDataType) {
    if (data.action === ActionEnum.Init) return;

    const message: MessageType = {
      sessionId: "sessionId" in data.data ? data.data.sessionId : data.data.id,
      badges: [],
    };

    const isHeader =
      data.entity === EntityEnum.BackupSession ||
      data.entity === EntityEnum.RestoreSession;

    const hasProgress =
      isHeader ||
      data.entity === EntityEnum.BackupSessionTask ||
      data.entity === EntityEnum.BackupSessionRepository ||
      data.entity === EntityEnum.RestoreSessionTask ||
      data.entity === EntityEnum.RestoreSessionRepository;

    if (data.action === ActionEnum.Start) {
      if (isHeader) {
        message.textPrefix = data.data.error ? red("⨉") : green("✓");
      } else {
        message.textPrefix = hasProgress ? "{spinner}" : grey("?");
      }
    } else if (data.action === ActionEnum.End) {
      message.textPrefix = data.data.error ? red("⨉") : green("✓");
      if (data.data.error)
        message.errorBadge = {
          name: "error",
          value: this.options.verbose
            ? data.data.error
            : data.data.error.split("\n")[0],
          color: red,
        };
    } else if (data.action === ActionEnum.Progress) {
      message.textPrefix = "{spinner}";
    }

    if (hasProgress) {
      message.progressPercent = data.data.progressPercent;
      message.progressCurrent = data.data.progressCurrent;
      message.progressTotal = data.data.progressTotal;
      message.progressStep = data.data.progressStep;
      message.progressStepPercent = data.data.progressStepPercent;
    }

    if (
      data.entity === EntityEnum.BackupSession ||
      data.entity === EntityEnum.RestoreSession
    ) {
      message.text = data.data.packageName;
      message.badges.push({
        name: "snap",
        value: data.data.snapshotId.slice(0, 8),
        color: cyan,
      });
    } else if (
      data.entity === EntityEnum.BackupSessionTask ||
      data.entity === EntityEnum.RestoreSessionTask
    ) {
      message.text = data.sessionData.packageName;
      message.badges.push({
        name: "task",
        value: data.data.taskName,
        color: cyan,
      });
    } else if (
      data.entity === EntityEnum.BackupSessionRepository ||
      data.entity === EntityEnum.RestoreSessionRepository
    ) {
      message.text = data.sessionData.packageName;
      message.badges.push({
        name: "repo",
        value: data.data.repositoryName,
        color: cyan,
      });
    }

    if (isHeader && data.action === ActionEnum.End) {
      return;
    }

    this.printMessage(message);

    if (!this.options.verbose)
      if (!hasProgress || data.action === ActionEnum.End || isHeader)
        process.stdout.write("\n");
  }
}
