import type { ReactNode } from 'react'
// Deliberately small Markdown subset. No HTML interpretation, links, image
// requests, embedded components or executable terminal sequences.
export function MarkdownDocument({text}:{text:string}){
 const blocks:ReactNode[]=[];let code:string[]|null=null,fence=''
 const lines=text.split(/\r?\n/)
 for(let index=0;index<lines.length;index++){
  const line=lines[index],marker=line.match(/^\s*(`{3,}|~{3,})/)
  if(marker){if(code===null){code=[];fence=marker[1][0]}else if(marker[1][0]===fence){blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>);code=null}else code.push(line);continue}
  if(code!==null){code.push(line);continue}
  const heading=line.match(/^(#{1,3})\s+(.+)$/)
  if(heading){blocks.push(heading[1].length===1?<h3 key={index}>{heading[2]}</h3>:<h4 key={index}>{heading[2]}</h4>);continue}
  if(/^\s*[-*]\s+/.test(line)){blocks.push(<p key={index} className="inspection-markdown-bullet">• {line.replace(/^\s*[-*]\s+/,'')}</p>);continue}
  if(line.trim())blocks.push(<p key={index}>{line}</p>)
 }
 if(code!==null)blocks.push(<pre key="last"><code>{code.join('\n')}</code></pre>)
 return <div className="inspection-markdown">{blocks}</div>
}
