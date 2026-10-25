import type { HostHarborApi } from '../shared/contracts'

declare global {
  interface Window { hostharbor: HostHarborApi }
}
