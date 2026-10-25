import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { analyzeQuery, queryPlan } from '../src/core/policy/queries'
import { parseQueryShell } from '../src/core/policy/query-shell'
import { evaluatePolicy } from '../src/core/policy/service'
import type { ApprovalPolicy } from '../src/shared/contracts'
const policy: ApprovalPolicy = { revision: 1, mode: 'assisted', rules: [], aiAssist: false }
const input = { profileId: 'synthetic-profile', serverId: 'synthetic-server', cwd: '/' }
export const composedQuery = `ss -lntp; echo '--- synthetic containers ---'; docker ps --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'; echo '--- synthetic services ---'; systemctl list-units --type=service --state=running --no-legend --plain`
const supported = [
  composedQuery,
  'ss -nltp && ps aux | head -n 20',
  'systemctl --no-pager list-units --type service --state running',
  'systemctl show --property=Id,MainPID,WorkingDirectory,FragmentPath,ActiveState synthetic.service',
  'systemctl status synthetic.service | tail -n 50',
  'systemctl is-active synthetic.service',
  'docker ps -a --format "{{.Names}} {{.Ports}}" | grep -F synthetic | head -20',
  "docker inspect -f '{{.Name}} {{.Config.Image}} {{.State.Status}} {{json .NetworkSettings.Ports}}' synthetic-container",
  'docker logs --tail 200 --since 1h synthetic-container 2>/dev/null | grep -inE "error|failed" | tail -n 20',
  "journalctl -u synthetic.service -n 200 --since '1 hour ago' --no-pager | grep -F error",
  'cat /etc/os-release; cat /proc/meminfo | head -n 5',
  'tail -n 200 /var/log/synthetic.log | grep -inE "error|failed" | head -n 20',
  "ps -eo pid,comm | awk '{print $1,$2}' | head -50",
  "cat /proc/cpuinfo | sed -n '1,20p'",
  'cat /var/log/synthetic.log | cut -d : -f 1,2 | uniq -c | wc -l',
  "ps aux | awk '{print $1}' | sort | uniq -c | sort -nr | head -20",
  'ps aux | sort -k 2,2n | head -n 10',
  'grep -e --not-an-option /var/log/synthetic.log',
  'grep -ieerror /var/log/synthetic.log',
  'ls --color never /data/synthetic',
  "ls -lah /data/synthetic; find -P /opt/synthetic -maxdepth 2 -type d -name 'synthetic-*' -print",
  'openssl x509 -in /etc/ssl/certs/synthetic.pem -noout -enddate -issuer',
  'openssl x509 -in /etc/letsencrypt/live/synthetic.invalid/fullchain.pem -dates',
  "echo 'a; b | literal $(not-executed) `literal`'; uname -a",
  'echo "literal label"; uname -a',
  "printf '%s\\n' 'synthetic one' 'synthetic two'; uptime",
  'ss -lntp;\n\n docker ps\n systemctl list-units',
  "echo 'literal single '\\'' quote'; /usr/bin/uname -r",
  'uname \\\n-a |\n head -n 2',
  'date -Is; date --iso-8601=seconds; df -hT /',
  'head -c 100 /var/log/synthetic.log; tail --lines=50 /var/log/synthetic.log.1',
]
const unsupported = [
  'ss -lntp; docker restart synthetic', 'docker exec synthetic ps aux', 'docker cp synthetic:/x /tmp/x',
  'docker --host tcp://synthetic.invalid ps', 'docker context use synthetic',
  'docker inspect synthetic', "docker inspect --format '{{.Config.Env}}' synthetic", "docker ps --format '{{println .Names}}'",
  'docker logs -f synthetic', 'docker logs --tail all synthetic', 'docker logs --tail 999999 synthetic', 'docker logs synthetic',
  'systemctl restart synthetic.service', 'systemctl daemon-reload', 'systemctl show synthetic.service',
  'systemctl show -p Environment synthetic.service', 'systemctl --root /tmp/synthetic list-units',
  'ss -K', 'ss --kill', 'hostname synthetic-new-name', 'date -s 2026-01-01', 'free -s 1',
  'uname -a; echo x > /tmp/synthetic', 'uname -a 2>>/tmp/synthetic', 'uname -a < /etc/os-release',
  'uname -a 2>/dev/null ignored', 'uname -a &', 'uname -a &> /dev/null',
  '(uname -a)', '{ uname -a; }', 'uname -a; for x in a; do echo x; done', 'sh -c "uname -a"', 'bash -c "pwd"',
  'env uname -a', 'command uname -a', 'sudo ss -lntp', 'PATH=/tmp uname -a', 'x=pwd; $x',
  'echo "$(uname -a)"; pwd', 'echo "`uname -a`"; pwd', 'echo "$HOME"; pwd', 'uname $(echo -a)',
  'echo x; pwd # hidden', 'cat /var/log/*.log', 'cat /var/log/synthetic.log{,1}', "cat /var/log/'*.log'",
  'cat /etc/shadow', 'cat /root/.ssh/id_ed25519', 'cat /proc/1/environ',
  'cat /var/log/synthetic/../../etc/shadow.log', 'cat /data/synthetic/.env',
  'grep -r error /var/log', 'grep -f /tmp/synthetic /var/log/synthetic.log', 'grep --exclude=* error /var/log/synthetic.log',
  'pwd | grep -eerror /etc/shadow', 'pwd | grep -ineerror /etc/shadow', 'pwd | grep --regexp=error /etc/shadow',
  'head -n 0 /var/log/synthetic.log', 'head -n 99999 /var/log/synthetic.log', 'tail --follow /var/log/synthetic.log',
  "ps aux | awk 'BEGIN {system(\"touch /tmp/synthetic\")}'", "ps aux | awk '{print > \"/tmp/synthetic\"}'",
  "ps aux | awk '{print $1; system($2)}'", "ps aux | sed -n '1,20p; e id'", "sed -i '1p' /var/log/synthetic.log",
  'ps aux | sort -o /tmp/synthetic', 'ps aux | uniq /var/log/synthetic.log /tmp/synthetic', 'ps aux | tee /tmp/synthetic',
  'journalctl --vacuum-time=1d', 'journalctl -u synthetic.service --follow', 'journalctl -n 10',
  'find /data/synthetic -delete', 'find /data/synthetic -exec uname -a ;', 'find -L /data/synthetic -type f',
  "find /data/synthetic -printf '%p'", 'find /data/synthetic -maxdepth 99',
  'ls -R /data/synthetic', 'ls --dired /data/synthetic',
  'openssl x509 -in /etc/letsencrypt/live/synthetic.invalid/privkey.pem -dates',
  'openssl x509 -in /etc/ssl/certs/synthetic.pem -out /tmp/synthetic -dates', 'openssl s_client -connect synthetic.invalid:443',
  'ss -lntp | sh', 'cat /etc/os-release | /tmp/grep os', 'ss -lntp; unknown-query',
  "echo 'unterminated; pwd", 'pwd &&', 'pwd |', 'pwd;;uname -a', 'pwd\0', 'uname\x1b -a',
  "printf '%n' 'synthetic'; pwd", 'echo -e "\\x1b"; pwd',
]
describe('composable query authorization', () => {
  it.each(supported)('authorizes and rebuilds supported syntax: %s', command => {
    const decision = evaluatePolicy(policy, { ...input, command })
    expect(decision.action, JSON.stringify(decision.queryAnalysis)).toBe('allow')
    expect(decision.queryPlan?.version).toBe(2)
    expect(decision.queryPlan?.command).not.toBeUndefined()
    // Parse-check the actual rebuilt shell without executing it. Windows has no sh.
    if (process.platform !== 'win32') execFileSync('/bin/sh', ['-n', '-c', decision.queryPlan!.command])
    expect(decision.queryAnalysis?.checks.every(c => c.status === 'supported')).toBe(true)
    expect(decision.aiReview).toBeUndefined()
  })
  it.each(unsupported)('requires approval for unsupported behavior: %s', command => {
    const decision = evaluatePolicy(policy, { ...input, command })
    expect(decision.action).toBe('approval')
    expect(decision.queryPlan).toBeUndefined()
  })
  it('explains every failed stage without copying unknown command data into the reason', () => {
    const result = analyzeQuery('ss -lntp; synthetic-secret-command; systemctl restart synthetic.service; uname -a')
    expect(result.plan).toBeUndefined()
    expect(result.analysis.checks.map(c => c.status)).toEqual(['supported', 'approval', 'approval', 'supported'])
    const decision = evaluatePolicy(policy, { ...input, command: 'ss -lntp; synthetic-secret-command' })
    expect(decision.reason).toContain('第 2 段')
    expect(decision.reason).not.toContain('synthetic-secret-command')
  })
  it('bounds complexity and checks both sides of a pipeline/conditional without partial dispatch', () => {
    expect(queryPlan(Array(32).fill('pwd').join(';'))).toBeDefined()
    expect(queryPlan(Array(33).fill('pwd').join(';'))).toBeUndefined()
    expect(queryPlan(`echo '${'x'.repeat(16384)}'; pwd`)).toBeUndefined()
    for (const query of ['ss -lntp', 'docker ps', 'systemctl list-units']) {
      for (const op of [';', '&&', '|']) {
        expect(queryPlan(`${query} ${op} synthetic-unknown`)).toBeUndefined()
        expect(queryPlan(`synthetic-unknown ${op} ${query}`)).toBeUndefined()
      }
    }
  })
  it('preserves quoted punctuation as data and canonicalizes options and stderr suppression', () => {
    const plan = queryPlan("echo 'literal $(synthetic) ; |'; ss -lntp 2>/dev/null | head -20")!
    expect(plan.command).toContain("'literal $(synthetic) ; |'")
    expect(plan.command).toContain('/usr/bin/ss -l -n -t -p 2>/dev/null | /usr/bin/head -n 20')
    expect(parseQueryShell("echo 'a;b'; ss -lntp")[0].commands[0].words).toEqual(['echo', 'a;b'])
  })
  it('executes rebuilt quoted labels as literal data without expanding shell substitutions', () => {
    if (process.platform === 'win32') return
    const plan = queryPlan("echo 'literal $(printf EXPANDED) `printf EXPANDED`'; uname -r")!
    const output = execFileSync('/bin/sh', ['-c', plan.command], { encoding: 'utf8' })
    expect(output).toContain('literal $(printf EXPANDED) `printf EXPANDED`')
  })
  it('normalizes optional arguments without turning values into unvalidated operands', () => {
    expect(queryPlan('ls --color never /data/synthetic')?.command).toContain('--color=never /data/synthetic')
    expect(queryPlan('date --iso-8601 seconds')?.command).toContain('--iso-8601=seconds')
    expect(queryPlan('date -I seconds')?.command).toContain('-Iseconds')
    for (const option of ['-eerror', '-ineerror', '--regexp=error', '-e error']) {
      expect(queryPlan(`pwd | grep ${option} /etc/shadow`)).toBeUndefined()
    }
  })
  it('keeps explicit rules, risk rules and non-assisted modes dominant', () => {
    for (const mode of ['all-approval', 'rules', 'paused'] as const) expect(evaluatePolicy({ ...policy, mode }, { ...input, command: composedQuery }).action).not.toBe('allow')
    const rule = { id: 'synthetic-rule', name: 'synthetic rule', enabled: true, action: 'approval' as const, profileIds: [], serverIds: [], command: composedQuery, cwd: null, expiresAt: null }
    expect(evaluatePolicy({ ...policy, rules: [rule] }, { ...input, command: composedQuery }).action).toBe('approval')
    expect(evaluatePolicy(policy, { ...input, command: "echo 'rm'; ss -lntp" }).action).toBe('allow')
  })
})
