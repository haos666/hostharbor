import type { ReactNode } from 'react'
import type { AppStatus } from '../../../shared/contracts'
import { PageHeader } from './PageHeader'
import { UnlockGate } from './SecuritySettings'

/** A single locked-workspace template; route content cannot change its alignment. */
export function LockedPage({label,title,status,onRefresh,onSetup,navigation,panel}:{label:ReactNode;title:ReactNode;status:AppStatus|null;onRefresh:()=>Promise<void>;onSetup:()=>void;navigation?:ReactNode;panel?:{id:string;labelledBy:string}}) {
 return <section className="locked-page"><PageHeader label={label} title={title}/><div className="locked-page-body">{navigation&&<div className="locked-page-navigation">{navigation}</div>}<UnlockGate panel={panel} status={status} onRefresh={onRefresh} onSetup={onSetup}/></div></section>
}
