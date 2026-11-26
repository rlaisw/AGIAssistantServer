import { clearDiscoveryCache } from "../discovery"
import { clearJwksCache } from "../jwks"
import { clearRenewalInflight } from "../renew"

export function resetAuthCaches(): void {
  clearDiscoveryCache()
  clearJwksCache()
  clearRenewalInflight()
}
