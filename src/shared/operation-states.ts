import type { OperationState } from './contracts'

// Terminal includes unknown: dispatch has ended, but the remote outcome may be uncertain.
export const terminalOperationStates: readonly OperationState[] = ['succeeded', 'failed', 'denied', 'interrupted', 'unknown', 'expired']
export function isTerminalOperation(state: OperationState): boolean { return terminalOperationStates.includes(state) }
