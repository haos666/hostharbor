import { inspectionDashboard, inspectionMetricText } from './inspection-dashboard'
import { crc32 } from 'node:zlib'
import { msg, getLocale } from '../shared/i18n'
import type { InspectionReport } from '../shared/inspection'
export type ReportExportFormat='md'|'docx'|'html'
export interface ReportDocument {serverName:string;report:InspectionReport;background?:import('../shared/report-style').ReportBackground}
const clean=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
const xml=(s:string)=>clean(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
const md=(s:string)=>clean(s).replace(/([\\`*_{}\[\]<>#|])/g,'\\$1')
interface Block {kind:'title'|'heading'|'text'|'code';text:string}
function blocks({serverName,report:r}:ReportDocument):Block[]{
 const date=(v:number)=>new Date(v).toLocaleString(getLocale())
 const out:Block[]=[{kind:'title',text:msg('reportFiles.reportTitle')},{kind:'text',text:`${msg('approvalSettings.server')}: ${serverName}`},{kind:'text',text:`${msg('inspection.result')}: ${msg(`inspection.status.${r.status}`)}`},{kind:'text',text:`${msg('inspection.time')}: ${date(r.startedAt)} — ${date(r.finishedAt)}`},{kind:'text',text:`${msg('inspectionModule.versionColumn')}: v${r.planRevision} · ${msg('inspection.submitter')}: ${r.profileName}`},{kind:'heading',text:msg(r.ignoredCount?'review.originalSummary':'reportFiles.summary')},{kind:'text',text:r.summary}]
 if(r.ignoredCount)out.push({kind:'text',text:`${msg('review.original')}: ${msg(`inspection.status.${r.originalStatus??r.status}`)} · ${msg('review.ignoredCount',{count:r.ignoredCount})}`})
 if(r.contextChanged)out.push({kind:'text',text:msg('inspection.contextChanged')})
 for(const item of r.items){out.push({kind:'heading',text:r.plan.checks.find(c=>c.id===item.checkId)?.title??item.checkId},{kind:'text',text:item.ignored?msg('review.ignored'):msg(`inspection.status.${item.status}`)},{kind:'text',text:item.finding});if(item.ignored)out.push({kind:'text',text:`${msg('review.reason')}: ${item.ignored.reason||'—'} · ${date(item.ignored.at)}`});if(item.subject)out.push({kind:'text',text:item.subject});for(const metric of item.metrics??[])out.push({kind:'text',text:inspectionMetricText(metric)});for(const id of item.operationIds){const e=r.evidence.find(v=>v.id===id);out.push({kind:'code',text:`${id} · ${e?.state??'—'} · ${msg('inspection.exitCode')}: ${e?.exitCode??'—'}`})}}
 out.push({kind:'heading',text:msg('inspection.planSnapshot')},...r.plan.markdown.split(/\r?\n/).map(text=>({kind:'code' as const,text})))
 return out
}
export function reportMarkdown(document:ReportDocument):string {
 return blocks(document).map(b=>b.kind==='title'?`# ${md(b.text)}`:b.kind==='heading'?`## ${md(b.text)}`:b.kind==='code'?`    ${clean(b.text)}`:md(b.text)).join('\n\n')+'\n'
}
export function reportHtml(document:ReportDocument):string {return inspectionDashboard(document)}
// Minimal OOXML package using ZIP's stored method; no external converter or runtime dependency.
function zip(entries:Record<string,string>):Buffer {
 const files:Buffer[]=[],central:Buffer[]=[];let offset=0
 for(const [name,text]of Object.entries(entries)){const filename=Buffer.from(name),data=Buffer.from(text),crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);files.push(header,filename,data)
  const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x21,14);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(filename.length,28);dir.writeUInt32LE(offset,42);central.push(dir,filename);offset+=header.length+filename.length+data.length
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...files,directory,end])
}
export function reportDocx(document:ReportDocument):Buffer {
 const paragraphs=blocks(document).map(b=>`<w:p><w:pPr><w:pStyle w:val="${b.kind==='title'?'Title':b.kind==='heading'?'Heading1':b.kind==='code'?'Code':'Normal'}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(b.text)}</w:t></w:r></w:p>`).join('')
 return zip({
 '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'word/document.xml':`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
 'word/styles.xml':'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="172125"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>',
 })
}
export function formatReport(document:ReportDocument,format:ReportExportFormat):Buffer {return format==='docx'?reportDocx(document):Buffer.from(format==='html'?reportHtml(document):reportMarkdown(document))}
