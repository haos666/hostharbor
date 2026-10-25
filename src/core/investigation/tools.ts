import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { InvestigationEvidence } from '../../shared/dossier'
export const querySchema = z.object({ query: z.enum(['overview', 'runtimes', 'process', 'service', 'container', 'directory']), target: z.string().max(512).default(''), purpose: z.string().min(1).max(200) }).strict()
export type Query = z.infer<typeof querySchema>
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
export const overviewCommand = `export LC_ALL=C; printf '\\n[system]\\n'; uname -srm; if [ -r /etc/os-release ]; then sed -n '/^PRETTY_NAME=/p' /etc/os-release; fi; printf '\\n[cpu]\\n'; getconf _NPROCESSORS_ONLN; lscpu 2>/dev/null | head -25; printf '\\n[memory]\\n'; free -b; printf '\\n[disks]\\n'; df -Pk | head -35; printf '\\n[uptime]\\n'; uptime; true`
export const runtimesCommand = `export LC_ALL=C; printf '\\n[processes pid comm]\\n'; ps -eo pid=,comm= | head -120; printf '\\n[ports]\\n'; ss -lntup 2>/dev/null | head -65; printf '\\n[services]\\n'; systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | head -65; printf '\\n[containers]\\n'; docker ps --no-trunc --format '{{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Ports}}' 2>/dev/null | head -45; true`
export function queryCommand(query: Query, evidence: InvestigationEvidence[]): string {
  const source = evidence.filter(e => e.state === 'succeeded').map(e => e.preview).join('\n')
  const target = query.target
  const seen = (pattern: RegExp) => pattern.test(source)
  switch (query.query) {
    case 'overview': if (target) break; return overviewCommand
    case 'runtimes': if (target) break; return runtimesCommand
    case 'process':
      if (!/^[1-9][0-9]{0,8}$/.test(target) || !seen(new RegExp(`(^|\\n)\\s*(?:MainPID=)?${target}(?:\\s|$)`))) break
      return `printf '[executable]\\n'; readlink /proc/${target}/exe; printf '[working-directory]\\n'; readlink /proc/${target}/cwd`
    case 'service':
      if (!/^[A-Za-z0-9_@.:-]{1,160}\.service$/.test(target) || !source.split(/\s+/).includes(target)) break
      return `systemctl show --no-pager --property=Id,MainPID,WorkingDirectory,FragmentPath,ActiveState ${quote(target)}`
    case 'container':
      if (!/^[a-f0-9]{12,64}$/.test(target) || !source.split(/\s+/).includes(target)) break
      // Deliberately excludes Env, Cmd, Args, labels, credentials and complete inspect output.
      return `docker inspect --format '{{json .Name}} {{json .Config.Image}} {{json .State.Pid}} {{json .Mounts}} {{json .NetworkSettings.Ports}}' ${quote(target)}`
    case 'directory': {
      const fixed = ['/opt', '/srv', '/var/www', '/usr/local', '/app', '/data']
      if (!/^\/[A-Za-z0-9_./ -]{1,400}$/.test(target) || target.split('/').some(p => p === '..' || p.startsWith('.')) || /^\/(etc|proc|sys|dev|run)(\/|$)/.test(target)) break
      const paths: string[] = source.match(/\/[A-Za-z0-9_./-]+/g) ?? []
      if (!fixed.includes(target) && !paths.includes(target)) break
      return `find -P ${quote(target)} -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -50`
    }
  }
  throw new AppError('INVALID_INPUT')
}
