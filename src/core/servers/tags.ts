import { randomUUID } from 'node:crypto'
import { serverTagsSchema, emptyServerTags, type ServerTags } from '../../shared/server-tags'
import { AppError } from '../../shared/errors'
import { parse } from '../validation'
import type { ServerService } from './service'

export const serverTagsKey='server-tags:v1'
export class ServerTagsService {
 constructor(private servers:ServerService){}
 get():ServerTags {
  this.servers.assertUnlocked()
  const row=this.servers.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(serverTagsKey)
  if(!row)return emptyServerTags()
  const plain=this.servers.reveal(serverTagsKey,row.value as Uint8Array)
  try{
   const state=serverTagsSchema.parse(JSON.parse(plain.toString()))
   const ids=new Set(this.servers.store.listServers().map(s=>s.id))
   state.assignments=Object.fromEntries(Object.entries(state.assignments).filter(([id])=>ids.has(id)))
   return state
  }catch{throw new AppError('STORAGE_FAILED')}finally{plain.fill(0)}
 }
 save(raw:unknown):ServerTags {
  this.servers.assertUnlocked()
  const state=parse(serverTagsSchema,raw),current=this.get()
  if(state.revision!==current.revision)throw new AppError('TAGS_CHANGED')
  if(Object.keys(state.assignments).some(id=>!this.servers.store.getServer(id)))throw new AppError('NOT_FOUND')
  const next={...state,revision:current.revision+1},plain=Buffer.from(JSON.stringify(next))
  try{this.servers.store.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(serverTagsKey,this.servers.protect(serverTagsKey,plain))}finally{plain.fill(0)}
  return next
 }
 // Restore only new, selected servers; existing assignments and colors win on name matches.
 restore(source:ServerTags,mapping:Map<string,string>):void {
  const state=this.get(),ids=new Map<string,string>()
  for(const tag of source.tags){let target=state.tags.find(t=>t.name.toLocaleLowerCase('en-US')===tag.name.toLocaleLowerCase('en-US'));if(!target){target={...tag,id:randomUUID(),...(tag.pinned&&state.tags.filter(t=>t.pinned).length>=4?{pinned:false}:{})};state.tags.push(target)}ids.set(tag.id,target.id)}
  for(const [old,id]of mapping){state.assignments[id]=(source.assignments[old]??[]).map(t=>ids.get(t)!)}
  this.save(state)
 }
}
