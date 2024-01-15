import { AppError } from "./error";
import { post } from "./http";

export type TelegramStepConfig = {
  bot: string;
  chatId: number;
};

export type NtfyStepConfig = {
  token: string;
  topic?: string;
};

export type ReportStep =
  | {
      type: "telegram";
      config: TelegramStepConfig;
    }
  | {
      type: "ntfy";
      config: NtfyStepConfig;
    };

export type ReportStepOptions = {
  data: {
    title: string;
    message: string;
    success: boolean;
  };
};

export function isReportStep(step: {
  type: string;
}): step is Pick<ReportStep, "type"> {
  return step.type === "telegram" || step.type === "ntfy";
}

export async function runReportSteps(
  input: ReportStep[] | ReportStep,
  options: ReportStepOptions,
) {
  const steps = Array.isArray(input) ? input : [input];
  for (const step of steps) {
    if (step.type === "telegram") {
      await post(
        `https://api.telegram.org/bot${step.config.bot}/sendMessage`,
        JSON.stringify({
          chat_id: step.config.chatId.toString(),
          text: options.data.message,
          disable_notification: options.data.success ? false : true,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    } else if (step.type === "ntfy") {
      const topic = [step.config.token, step.config.topic]
        .filter(Boolean)
        .join("-");
      if (topic.length < 32)
        throw new AppError(
          `'step.config.topic' is less than 32 characters: ${topic}`,
        );
      await post(`https://ntfy.sh/${topic}`, options.data.message, {
        headers: {
          Title: options.data.title,
          Priority: options.data.success ? "default" : "high",
        },
      });
    } else {
      throw new AppError(`Invalid step type: ${(step as any).type}`);
    }
  }
}
