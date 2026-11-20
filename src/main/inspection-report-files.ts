import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink, readdir, lstat } from 'node:fs/promises'
import { renameSync } from 'node:fs'
import { basename, dirname, join, isAbsolute } from 'node:path'
import { z } from 'zod'
import { AppError } from '../shared/errors'
import type { InspectionReport } from '../shared/inspection'
import { formatReport, type ReportExportFormat } from './inspection-report-format'
interface ReportCore {call<T>(method:string,payload?:unknown):Promise<T>}
interface Adapters {save:(format:ReportExportFormat,filename:string)=>Promise<string|null>;open:(path:string)=>Promise<void>}
const identity=z.object({serverId:z.string().uuid(),id:z.string().uuid()}).strict()
export class DesktopInspectionReports {
 constructor(private core:ReportCore,private revision:()=>number,private directory:string,private adapters:Adapters,private background:()=>import('../shared/report-style').ReportBackground=()=> 'default'){}
 private async guard(){const revision=this.revision(),state=await this.core.call<{vault:string}>('status');if(state.vault!=='unlocked'||this.revision()!==revision)throw new AppError('VAULT_LOCKED');return async()=>{const state=await this.core.call<{vault:string}>('status');if(state.vault!=='unlocked'||this.revision()!==revision)throw new AppError('VAULT_LOCKED')}}
 private async document(input:z.infer<typeof identity>){const report=await this.core.call<InspectionReport>('getInspectionReport',input);const servers=await this.core.call<{id:string;name:string}[]>('listServers');const server=servers.find(s=>s.id===input.serverId);if(!server)throw new AppError('NOT_FOUND');return {serverName:server.name,report,background:this.background()}}
 private async maintain(){await mkdir(this.directory,{recursive:true,mode:0o700});const files=[];for(const name of await readdir(this.directory)){if(!/^[a-f0-9-]{36}\.html$/.test(name))continue;const path=join(this.directory,name),stat=await lstat(path);if(stat.isFile())files.push({path,time:stat.mtimeMs})}files.sort((a,b)=>b.time-a.time);for(const [index,file]of files.entries())if(index>=31||file.time<Date.now()-86400000)await unlink(file.path).catch(()=>{})}
 async open(raw:unknown):Promise<void>{const check=await this.guard(),parsed=identity.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_INPUT');const document=await this.document(parsed.data);await check();await this.maintain();const path=join(this.directory,`${randomUUID()}.html`);try{await writeFile(path,formatReport(document,'html'),{flag:'wx',mode:0o600});await check();await this.adapters.open(path)}catch(error){await unlink(path).catch(()=>{});throw error instanceof AppError?error:new AppError('REPORT_FILE_OPEN')}}
 async export(raw:unknown):Promise<{name:string}|null>{const check=await this.guard(),parsed=identity.extend({format:z.enum(['md','docx','html'])}).safeParse(raw);if(!parsed.success)throw new AppError('INVALID_INPUT');const {format,...input}=parsed.data,document=await this.document(input);await check();const path=await this.adapters.save(format,`HostHarbor-inspection-${new Date(document.report.finishedAt).toISOString().replace(/[:.]/g,'-')}.${format}`);await check();if(!path)return null;if(!isAbsolute(path))throw new AppError('INVALID_INPUT');const temp=join(dirname(path),`.hostharbor-report-${randomUUID()}.tmp`);try{await writeFile(temp,formatReport(document,format),{flag:'wx',mode:0o600});await check();renameSync(temp,path);return {name:basename(path)}}catch(error){throw error instanceof AppError?error:new AppError('REPORT_FILE_WRITE')}finally{await unlink(temp).catch(()=>{})}}
}
