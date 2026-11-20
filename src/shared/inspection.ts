import { z } from 'zod'
const id=z.string().uuid(),revision=z.number().int().nonnegative().safe(),time=z.number().int().nonnegative().safe()
export const inspectionStatus=z.enum(['normal','abnormal','incomplete','not_applicable'])
export type InspectionStatus=z.infer<typeof inspectionStatus>
export const inspectionDocumentSchema=z.object({title:z.string().trim().min(1).max(160),markdown:z.string().trim().min(1).max(24000).refine(s=>!s.includes('\0')),applicationIds:z.array(id).max(40)}).strict()
export const inspectionSaveSchema=inspectionDocumentSchema.extend({serverId:id,serverRevision:revision,revision,contextDigest:z.string().min(1).max(128)}).strict()
export type InspectionDocument=z.infer<typeof inspectionDocumentSchema>
export type InspectionSave=z.infer<typeof inspectionSaveSchema>
export interface InspectionCheck {id:string;title:string}
export interface InspectionPlan extends InspectionDocument {serverId:string;serverRevision:number;revision:number;digest:string;contextDigest:string;updatedAt:number;checks:InspectionCheck[];applicationRefs:{id:string;revision:number}[];stale?:boolean}
export interface InspectionWorkspace {plan:InspectionPlan|null;serverRevision:number;contextDigest:string;applications:{id:string;name:string;revision:number;connectionChanged:boolean}[]}
export const inspectionDraftSchema=z.object({serverId:id,serverRevision:revision,revision,contextDigest:z.string().max(128),useAi:z.boolean(),aiRevision:revision.optional(),consent:z.boolean().optional(),locale:z.enum(['zh-CN','en'])}).strict()
export type InspectionDraftInput=z.infer<typeof inspectionDraftSchema>
export interface InspectionDraft extends InspectionDocument {serverRevision:number;revision:number;contextDigest:string}
const metricEvidence={observedAt:time,operationId:id}
const capacity={usedBytes:z.number().int().nonnegative().safe(),totalBytes:z.number().int().positive().safe()}
export const inspectionMetricSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('cpu'),usagePercent:z.number().min(0).max(100),...metricEvidence}).strict(),
 z.object({kind:z.literal('memory'),...capacity,...metricEvidence}).strict(),
 z.object({kind:z.literal('disk'),mount:z.string().trim().min(1).max(200),...capacity,...metricEvidence}).strict(),
]).refine(m=>m.kind==='cpu'||m.usedBytes<=m.totalBytes)
export type InspectionMetric=z.infer<typeof inspectionMetricSchema>
const inspectionReportItemSchema=z.object({checkId:z.string().regex(/^check-\d+$/),status:inspectionStatus,finding:z.string().trim().min(1).max(1200),operationIds:z.array(id).max(8),section:z.enum(['system','application','custom']).optional(),subject:z.string().trim().min(1).max(160).optional(),metrics:z.array(inspectionMetricSchema).max(20).optional()}).strict()
export const inspectionReportInputSchema=z.object({serverId:id,planRevision:revision.positive(),planDigest:z.string().regex(/^[a-f0-9]{64}$/),serverRevision:revision.positive(),requestKey:z.string().min(1).max(100),startedAt:time,finishedAt:time,summary:z.string().trim().min(1).max(2000),items:z.array(inspectionReportItemSchema).min(1).max(40)}).strict()
export type InspectionReportInput=z.infer<typeof inspectionReportInputSchema>
export interface InspectionReport extends InspectionReportInput {originalStatus?:InspectionStatus;reviewRevision?:number;ignoredCount?:number;items:(InspectionReportInput['items'][number]&{ignored?:InspectionIgnore})[];id:string;profileId:string;profileName:string;receivedAt:number;status:InspectionStatus;plan:InspectionPlan;contextChanged:boolean;requestHash:string;evidence:{id:string;state:string;exitCode?:number;createdAt:number;replayClearedAt?:number|null}[]}
export type InspectionReportSummary=Pick<InspectionReport,'id'|'receivedAt'|'startedAt'|'finishedAt'|'status'|'summary'|'profileName'|'planRevision'|'contextChanged'>&{counts:Record<InspectionStatus,number>;ignoredCount?:number}
export interface InspectionReportPage {reports:InspectionReportSummary[];total:number;offset:number;pageSize:number}
export const inspectionReportQuerySchema=z.object({serverId:id,offset:z.number().int().min(0).max(10000).default(0),pageSize:z.union([z.literal(10),z.literal(20)]).default(10)}).strict()
// Heading positions are version-bound IDs, never executable selectors.
export function inspectionChecks(markdown:string):InspectionCheck[]{
 const checks:InspectionCheck[]=[];let fence:string|null=null
 for(const line of markdown.split(/\r?\n/)){
  const marker=line.match(/^\s*(`{3,}|~{3,})/)
  if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;continue}
  if(fence)continue
  const heading=line.match(/^##\s+(.+?)\s*#*\s*$/)
  if(heading)checks.push({id:`check-${checks.length+1}`,title:heading[1].slice(0,160)})
 }
 return checks
}

export const inspectionCatalogQuerySchema=z.object({
 kind:z.enum(['plans','reports']),query:z.string().trim().max(200).default(''),serverId:id.optional(),tagId:id.optional(),status:inspectionStatus.optional(),
 from:time.optional(),to:time.optional(),offset:z.number().int().min(0).max(1000000).default(0),pageSize:z.union([z.literal(10),z.literal(20)]).default(10),
}).strict().refine(q=>q.from===undefined||q.to===undefined||q.from<=q.to)
export type InspectionCatalogQuery=z.input<typeof inspectionCatalogQuerySchema>
export interface InspectionCatalogRow {
 serverId:string;serverName:string;tags:import('./server-tags').ServerTag[];title:string;revision:number;updatedAt:number;checkCount:number;stale:boolean;latest:InspectionReportSummary|null
}
export interface InspectionCatalogPage {
 plans:InspectionCatalogRow[];reports:(InspectionReportSummary&{serverId:string;serverName:string;title:string})[];
 total:number;offset:number;pageSize:number;configuredServerIds:string[]
}

export interface InspectionIgnore {reason:string;at:number}
export interface InspectionExceptionDraft {instruction:string;planRevision:number;serverRevision:number;contextDigest:string;reviewRevision:number}
export const inspectionIgnoreSchema=z.object({serverId:id,id,checkId:z.string().regex(/^check-\d+$/),revision,ignored:z.boolean(),reason:z.string().trim().max(500).default('')}).strict()
export const inspectionExceptionDraftSchema=z.object({serverId:id,id,checkId:z.string().regex(/^check-\d+$/),reason:z.string().trim().max(500).default(''),aiRevision:revision,consent:z.literal(true),locale:z.enum(['zh-CN','en'])}).strict()
export const inspectionExceptionText=z.string().trim().min(1).refine(s=>Array.from(s).length<=50&&!/[\x00-\x1f\x7f]/.test(s))
export const inspectionExceptionSaveSchema=z.object({serverId:id,id,checkId:z.string().regex(/^check-\d+$/),instruction:inspectionExceptionText,planRevision:revision.positive(),serverRevision:revision,contextDigest:z.string().min(1).max(128),reviewRevision:revision,ignoreCurrent:z.boolean(),reason:z.string().trim().max(500).default(''),locale:z.enum(['zh-CN','en'])}).strict()
export function effectiveInspectionStatus(items:{status:InspectionStatus;ignored?:InspectionIgnore}[]):InspectionStatus {
 const active=items.filter(i=>!i.ignored)
 return active.some(i=>i.status==='abnormal')?'abnormal':active.some(i=>i.status==='incomplete')?'incomplete':active.length&&active.every(i=>i.status==='not_applicable')?'not_applicable':'normal'
}
