import type { RiskRuleSetting } from './contracts'

export const riskPresets = [
  { id: 'file-removal', name: '文件删除', commands: 'rm · unlink · shred', description: '删除文件、目录或擦除文件内容。' },
  { id: 'disk-write', name: '磁盘与文件系统', commands: 'mkfs · dd · wipefs · fdisk · parted', description: '格式化、写入磁盘或修改分区。' },
  { id: 'power-control', name: '关机与重启', commands: 'shutdown · reboot · poweroff · halt', description: '可能中断服务器及其上运行的服务。' },
  { id: 'permissions', name: '权限与属主修改', commands: 'chmod · chown · chgrp', description: '修改文件访问权限、属主或所属组。' },
] as const
export type RiskPresetId = typeof riskPresets[number]['id']
export const defaultRiskRules = (): RiskRuleSetting[] => riskPresets.map(({ id }) => ({ id, enabled: true, action: 'approval' }))
