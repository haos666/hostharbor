import type { ReactNode } from 'react'

/** Shared top-level heading geometry for every workspace and settings page. */
export function PageHeader({label,title,count,actions}:{label:ReactNode;title:ReactNode;count?:number;actions?:ReactNode}) {
 return <header className="credentials-header workspace-header"><div className="credentials-title workspace-heading"><span className="page-label">{label}</span><h1>{title}{count!==undefined&&count>0&&<span className="total-count">{count}</span>}</h1></div>{actions}</header>
}
