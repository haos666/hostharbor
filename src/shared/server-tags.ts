import { z } from 'zod'

export const serverTagSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(40),pinned:z.boolean().optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(v=>v.toLowerCase())}).strict()
export const serverTagsSchema=z.object({
 revision:z.number().int().nonnegative(),
 tags:z.array(serverTagSchema).max(200),
 assignments:z.record(z.string().uuid(),z.array(z.string().uuid()).max(20)),
}).strict().superRefine((state,ctx)=>{
 if(state.tags.filter(tag=>tag.pinned).length>4)ctx.addIssue({code:'custom',message:'At most four tag tabs'})
 const ids=new Set(state.tags.map(t=>t.id)),names=new Set(state.tags.map(t=>t.name.toLocaleLowerCase('en-US')))
 if(ids.size!==state.tags.length||names.size!==state.tags.length||Object.keys(state.assignments).length>10000||Object.values(state.assignments).some(tags=>new Set(tags).size!==tags.length||tags.some(id=>!ids.has(id))))ctx.addIssue({code:'custom',message:'Invalid tag references or duplicates'})
})
export type ServerTag=z.infer<typeof serverTagSchema>
export type ServerTags=z.infer<typeof serverTagsSchema>
export const emptyServerTags=():ServerTags=>({revision:0,tags:[],assignments:{}})
