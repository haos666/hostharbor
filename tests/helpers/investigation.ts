import type { DossierContent, InvestigationEvidence } from '../../src/shared/dossier'
export function requestEvidence(body: unknown): InvestigationEvidence[] {
  const evidence: InvestigationEvidence[] = []
  const visit = (v: unknown) => {
    if (typeof v === 'string') { if (/^\s*[\[{]/.test(v)) { try { visit(JSON.parse(v)) } catch {} }; return }
    if (!v || typeof v !== 'object') return
    if ('operationId' in v && 'preview' in v) { evidence.push(v as InvestigationEvidence); return }
    Object.values(v).forEach(visit)
  }
  visit(body); return evidence
}
export function fixtureReport(id: string): DossierContent {
  const fact = (value: string) => ({ value, confidence: 'evidenced' as const, evidenceIds: [id] })
  return {
    overview: '合成 Linux 服务器，运行示例 Web 服务。',
    system: { os: fact('Linux · Synthetic OS'), cpu: fact('4 核 · synthetic CPU'), memory: fact('8 GiB · 已用 2 GiB'), uptime: fact('3 天') },
    disks: [{ mount: '/', size: '100 GiB', used: '28 GiB (28%)', confidence: 'evidenced', evidenceIds: [id] }],
    applications: [{ name: 'Fixture Web', type: 'systemd / Node.js', status: '运行中', ports: ['8080/tcp'], confidence: 'evidenced', evidenceIds: [id], directories: [{ path: '/srv/fixture-web', kind: 'working', confidence: 'evidenced', evidenceIds: [id] }] }],
    unknowns: ['未读取业务配置与环境变量。', '数据库的数据目录尚未确认。'],
  }
}
