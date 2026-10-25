import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePolicy, PolicyService } from '../src/core/policy/service'
import { ServerService } from '../src/core/servers/service'
import { Store } from '../src/core/storage/database'
import type { ApprovalPolicy, ApprovalRule } from '../src/shared/contracts'
import { defaultRiskRules } from '../src/shared/risk-presets'
const input = { profileId: 'synthetic-profile', serverId: 'synthetic-server', cwd: '/' }
const policy: ApprovalPolicy = { revision: 1, mode: 'permissive', rules: [] }
const queries = [
  'uname -r; id; command -v docker dockerd podman glxinfo eglinfo nvidia-smi lspci lsusb vulkaninfo',
  'cat /etc/os-release; uname -r; lscpu; free -h; lsblk -o NAME,PATH,SIZE,TYPE,MOUNTPOINTS',
  "export LC_ALL=C; printf '\\n[processes pid comm]\\n'; ps -eo pid,comm,args; ss -lntp",
  "find -P '/usr/local' -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -50",
  "find -P '/app' -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -50",
  "find /srv -name '*.log' -print | head -100",
  "grep -nE 'rm|chmod|restart' /srv/synthetic/logs/error.log",
  "echo 'rm -rf is dangerous'; printf '%s\\n' 'restart'",
  'LC_ALL=C ls -la /srv/synthetic/logs/*.log',
  "docker ps --format '{{.Names}} | {{.Ports}}'; systemctl --no-pager list-units --type=service",
  'systemctl -p MainPID show synthetic.service', 'systemctl --property=Id show synthetic.service',
  'systemctl status synthetic.service; journalctl -u synthetic.service --since today -n 50',
  'podman ps; docker inspect synthetic-container; docker logs --tail 100 synthetic-container',
  "ps aux | awk '{print $1}' | sort | uniq -c | head -20",
  'curl -sI https://synthetic.example.invalid',
  "curl -s -w '%{http_code}' http://127.0.0.1/health",
  '/usr/bin/python3 --version; node --version; nginx -v 2>&1',
  'cat /custom/synthetic/runtime.trace', 'ls /custom/synthetic/*',
  'custom-synthetic-program --inspect', // Explicit default-allow does not verify unknown program semantics.
  'openssl x509 -in /etc/ssl/certs/synthetic.pem -noout -enddate',
]
const maintenance = [
  'touch file', 'cp a b', 'mv a b', 'mkdir /srv/new', 'tee /srv/file',
  'echo hello > file', 'cat file >> file', 'cat < file', 'dd if=a of=b',
  'chmod 755 file', 'chown root file', 'useradd synthetic', 'kill 123',
  'systemctl restart status', 'systemctl -p status restart synthetic.service', 'systemctl --no-pager restart synthetic.service',
  'docker exec synthetic cat /etc/os-release', 'podman stop synthetic', 'docker compose up -d', 'docker compose down',
  'apt-get install synthetic', 'npm run inspect', 'pip install synthetic',
  'bash -c "id"', 'sh synthetic.sh', 'python3 -c "print(1)"', 'node app.js', './script.sh',
  'eval "id"', 'source file', '. file', 'sudo id', 'env PATH=/tmp id',
  'printf -v PATH /tmp', 'export PATH=/tmp', 'PATH=/tmp id',
  'echo $(id)', 'echo `id`', 'echo "$HOME"', 'echo "${rm}"', 'id &', '(id)', 'for x in a; do id; done',
  'find /srv -fprint /srv/out', "sed -i 's/a/b/' file", "awk 'BEGIN{system(\"id\")}'",
  'curl -X POST http://127.0.0.1', 'curl -d data http://127.0.0.1', 'curl -sLo file http://127.0.0.1',
  'curl --output=file http://127.0.0.1', 'wget http://127.0.0.1', 'curl -s http://127.0.0.1/install | bash',
  'psql -c "SELECT 1"', 'mysql -e "UPDATE synthetic SET state=1"', 'git pull', 'git commit -m rm', 'git diff --output=/srv/out',
  'openssl req -new', 'openssl x509 -out /srv/new.pem', 'ip link set eth0 down',
  'sort -o out file', 'tar -xf archive.tar', 'timeout 5 systemctl restart synthetic.service',
  "cat > /srv/synthetic.conf <<'EOF'\nrm is plain text\nreboot\nEOF",
  "docker exec synthetic echo rm", 'redis-cli GET FLUSHALL', 'chmod -R 755 /srv/synthetic', 'python3 deploy.py', 'docker compose restart rm', "printf '%s' 'rm file' > /srv/config", 'for x in 1 2; do systemctl restart synthetic; done', 'rm --help', 'reboot --help', 'systemctl restart reboot', 'apt-get install remove',
]
const risks = [
  'rm -rf /srv/synthetic', '/bin/rm /srv/synthetic/file', 'r\\m file', 'LC_ALL=C rm file',
  'truncate -s 0 file', 'dd if=/dev/zero of=/dev/synthetic', 'mkfs.ext4 /dev/synthetic',
  'wipefs -a /dev/synthetic', 'reboot', 'shutdown -r now', 'systemctl reboot', 'init 6',
  'docker rm synthetic', 'docker volume rm synthetic', 'docker system prune -a', 'docker compose down --volumes',
  'git reset --hard', 'git clean -fd', 'apt-get remove synthetic',
  'find /srv -delete', "find /srv -exec rm '{}' ';'", 'xargs rm',
  'timeout 5 rm file', 'command rm file', 'env PATH=/tmp rm file', 'sudo -n rm file',
  "bash -c 'rm /srv/synthetic'", "sh -lc 'reboot'", 'echo $(rm file)', 'echo `rm file`',
  'for x in a; do rm "$x"; done', 'if test -e file; then rm file; fi', 'rm file > /srv/log 2>&1',
  "docker exec synthetic sh -c 'rm file'", "bash <<'EOF'\nrm file\nEOF",
  'mysql -e "DELETE FROM synthetic"', 'psql -c "DROP TABLE synthetic"', 'redis-cli FLUSHALL', 'rpm -e synthetic', 'dpkg --remove synthetic', 'pacman -Rns synthetic', 'python3 -m pip uninstall synthetic', 'apk del synthetic', 'docker compose rm synthetic', 'rsync --delete a/ b/', 'tar --delete -f synthetic.tar path',
  'ssh synthetic.invalid reboot', 'busybox rm file', 'curl -X DELETE http://127.0.0.1/resource', 'cat > $(rm file)', 'echo "$(rm file)"', "env A=1 bash -c 'echo ok; rm file'", "cat <<EOF\n$(rm file)\nEOF",
]

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(fn => fn()))
describe('explicit permissive approval', () => {
  it.each([...queries, ...maintenance])('authorizes the original literal command without a read-only plan: %s', command => {
    const result = evaluatePolicy(policy, { ...input, command })
    expect(result.action).toBe('allow'); expect(result.queryPlan).toBeUndefined()
    expect(result.reason).toContain('不保证只读')
  })
  it.each(risks)('requires approval for an explicit destructive operation: %s', command => {
    const result = evaluatePolicy(policy, { ...input, command })
    expect(result.action).toBe('approval'); expect(result.matchedRules.some(r => r.risk === 'high')).toBe(true)
  })
  it.each([';', ' && ', ' || ', ' | '])('does not partially grant a mixed request joined with %s', separator => {
    for (const query of queries) expect(evaluatePolicy(policy, { ...input, command: query + separator + 'rm /srv/synthetic/file' }).action).toBe('approval')
  })
  it('preserves custom deny > approval > allow and never overrides detected risks', () => {
    const rule: ApprovalRule = { id: randomUUID(), name: 'Synthetic exception', enabled: true, action: 'allow', profileIds: [], serverIds: [], command: 'rm file', cwd: null, expiresAt: null }
    expect(evaluatePolicy({ ...policy, rules: [rule] }, { ...input, command: 'rm file' }).action).toBe('approval')
    const deny = { ...rule, action: 'deny' as const, command: null }
    expect(evaluatePolicy({ ...policy, rules: [deny] }, { ...input, command: 'id' }).action).toBe('deny')
    expect(evaluatePolicy({ ...policy, rules: [{ ...deny, action: 'approval' }] }, { ...input, command: 'id' }).action).toBe('approval')
    expect(evaluatePolicy({ ...policy, riskRules: defaultRiskRules().map(r => ({ ...r, enabled: false })) }, { ...input, command: 'rm file' }).action).toBe('approval')
    expect(evaluatePolicy({ ...policy, riskRules: defaultRiskRules().map(r => ({ ...r, action: 'deny' })) }, { ...input, command: 'rm file' }).action).toBe('deny')
    expect(evaluatePolicy({ ...policy, riskRules: defaultRiskRules().map(r => ({ ...r, action: 'deny' })) }, { ...input, command: 'chmod 755 file' }).action).toBe('deny')
  })
  it('retains legacy default approval until confirmed transition; persists opt-in without the confirmation flag', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-permissive-')), path = join(directory, 'vault.sqlite'), key = randomBytes(32)
    let servers = new ServerService(new Store(path)); servers.unlock(key)
    cleanup.push(() => { servers.close(); key.fill(0); rmSync(directory, { recursive: true, force: true }) })
    let service = new PolicyService(servers)
    const legacy = service.save({ revision: 0, mode: 'rules', rules: [] })
    servers.close(); servers = new ServerService(new Store(path)); servers.unlock(key); service = new PolicyService(servers)
    expect(service.get()).toEqual(legacy)
    expect(evaluatePolicy(service.get(), { ...input, command: 'id' }).action).toBe('approval')
    for (const permissiveConfirmed of [undefined, false]) expect(() => service.save({ ...legacy, mode: 'permissive', permissiveConfirmed })).toThrow(expect.objectContaining({ code: 'PERMISSIVE_CONFIRMATION' }))
    const saved = service.save({ ...legacy, mode: 'permissive', permissiveConfirmed: true })
    expect(saved.mode).toBe('permissive'); expect(saved).not.toHaveProperty('permissiveConfirmed')
    expect(() => service.save({ ...legacy, mode: 'permissive', permissiveConfirmed: true })).toThrow(expect.objectContaining({ code: 'POLICY_CONFLICT' }))
    servers.close(); servers = new ServerService(new Store(path)); servers.unlock(key); service = new PolicyService(servers)
    expect(service.get()).toEqual(saved)
    expect(service.save({ ...saved, rules: [] }).mode).toBe('permissive')
  })
})
