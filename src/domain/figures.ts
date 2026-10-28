export const FIGURE_METRIC_NAMES = ["revenue", "net_income", "total_equity", "total_debt", "eps_basic", "dps"] as const;

export type FigureMetricName = (typeof FIGURE_METRIC_NAMES)[number];
