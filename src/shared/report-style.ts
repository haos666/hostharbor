export const reportBackgrounds=['default','aurora','grid','nebula'] as const
export type ReportBackground=typeof reportBackgrounds[number]
export function isReportBackground(value:unknown):value is ReportBackground {return typeof value==='string'&&reportBackgrounds.includes(value as ReportBackground)}
