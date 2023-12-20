import { Listr3, Listr3TaskResult, List3SummaryResult } from "../list";
import { isReportStep, runReportSteps } from "../reportSteps";
import { isSpawnStep, runSpawnSteps } from "../spawnSteps";
import { DatatruckReportConfig } from "./config-type";

export type ReportListTaskContext = { report: { type: string } };

export function createReportListTasks<T extends ReportListTaskContext>(
  list: Listr3<T>,
  options: {
    reports: DatatruckReportConfig[];
    onMessage: (
      result: (List3SummaryResult | Listr3TaskResult<T>)[],
      report: DatatruckReportConfig,
    ) => string;
    verbose?: boolean;
  },
) {
  return options.reports.map((report, index) => {
    const reportIndex = index + 1;
    return list.$task({
      title: {
        initial: `Send report ${reportIndex}`,
        started: `Sending report ${reportIndex}`,
        completed: `Report sent: ${reportIndex}`,
        failed: `Report send failed: ${reportIndex}`,
      },
      key: "report",
      keyIndex: index,
      data: { type: report.run.type },
      exitOnError: false,
      run: async (task) => {
        const result = list.getResult().filter((r) => r.key !== "report");
        const success = result.every((r) => !r.error);
        const enabled =
          !report.when ||
          (report.when === "success" && success) ||
          (report.when === "error" && !success);

        if (!enabled) return task.skip(`Report send skipped: ${reportIndex}`);
        const message = options.onMessage(result, report);
        if (isSpawnStep(report.run)) {
          await runSpawnSteps(report.run, {
            data: {
              dtt: {
                message,
                result,
                success,
              },
            },
            verbose: options.verbose,
          });
        } else if (isReportStep(report.run)) {
          await runReportSteps(report.run, {
            data: {
              title: "DTT Backup",
              message,
              success,
            },
          });
        } else {
          throw new Error(`Invalid step type: ${(report.run as any).type}`);
        }
      },
    });
  });
}
