export type ProgressStats = {
  percent?: number;
  total?: number;
  current?: number;
  description?: string;
  payload?: string;
  format?: "amount" | "size";
};

export type Progress = {
  absolute?: ProgressStats;
  relative?: ProgressStats;
};
