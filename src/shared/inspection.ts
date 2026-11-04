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
export const inspectionReportInputSchema=z.object({serverId:id,planRevision:revision.positive(),planDigest:z.string().regex(/^[a-f0-9]{64}$/),serverRevision:revision.positive(),requestKey:z.string().min(1).max(100),startedAt:time,finishedAt:time,summary:z.string().trim().min(1).max(2000),items:z.array(z.object({checkId:z.string().regex(/^check-\d+$/),status:inspectionStatus,finding:z.string().trim().min(1).max(1200),operationIds:z.array(id).max(8)}).strict()).min(1).max(40)}).strict()
export type InspectionReportInput=z.infer<typeof inspectionReportInputSchema>
export interface InspectionReport extends InspectionReportInput {id:string;profileId:string;profileName:string;receivedAt:number;status:InspectionStatus;plan:InspectionPlan;contextChanged:boolean;requestHash:string;evidence:{id:string;state:string;exitCode?:number;createdAt:number;replayClearedAt?:number|null}[]}
export type InspectionReportSummary=Pick<InspectionReport,'id'|'receivedAt'|'startedAt'|'finishedAt'|'status'|'summary'|'profileName'|'planRevision'|'contextChanged'>&{counts:Record<InspectionStatus,number>}
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
