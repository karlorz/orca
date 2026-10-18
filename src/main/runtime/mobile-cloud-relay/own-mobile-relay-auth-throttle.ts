export type AuthThrottleOptions = {
  maxFailures?: number
  windowMs?: number
  maxBuckets?: number
}

export type ThrottleCheckResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export type AuthThrottle = {
  check(email: string, ip: string | undefined, now?: number): ThrottleCheckResult
  recordFailure(email: string, ip: string | undefined, now?: number): void
  recordSuccess(email: string, ip: string | undefined, now?: number): void
  size(): number
}

const DEFAULT_MAX_FAILURES = 5
const DEFAULT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_BUCKETS = 4096

export function normalizeEmail(email: string): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

export function normalizeIp(ip: string | undefined): string {
  if (!ip || typeof ip !== 'string') {
    return 'unknown'
  }
  let normalized = ip.trim()
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7)
  }
  return normalized.length > 0 ? normalized : 'unknown'
}

type Bucket = {
  timestamps: number[]
  lastAccessed: number
}

export function createAuthThrottle(options: AuthThrottleOptions = {}): AuthThrottle {
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS

  const buckets = new Map<string, Bucket>()

  function emailIpKey(email: string, ip: string | undefined): string {
    return `eip:${normalizeEmail(email)}|${normalizeIp(ip)}`
  }

  function emailKey(email: string): string {
    return `e:${normalizeEmail(email)}`
  }

  function pruneBucket(bucket: Bucket, now: number): void {
    const cutoff = now - windowMs
    let startIdx = 0
    while (startIdx < bucket.timestamps.length && bucket.timestamps[startIdx] < cutoff) {
      startIdx++
    }
    if (startIdx > 0) {
      bucket.timestamps.splice(0, startIdx)
    }
  }

  function ensureCapacity(now: number, neededSlots: number = 1): void {
    // Opportunistic expiry pass: remove empty or completely expired buckets
    for (const [key, bucket] of buckets.entries()) {
      pruneBucket(bucket, now)
      if (bucket.timestamps.length === 0) {
        buckets.delete(key)
      }
    }

    // While over capacity, evict oldest by lastAccessed
    while (buckets.size + neededSlots > maxBuckets && buckets.size > 0) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.lastAccessed < oldestTime) {
          oldestTime = bucket.lastAccessed
          oldestKey = key
        }
      }
      if (oldestKey !== null) {
        buckets.delete(oldestKey)
      } else {
        break
      }
    }
  }

  function getRetryAfter(bucket: Bucket, now: number): number {
    if (bucket.timestamps.length < maxFailures) {
      return 0
    }
    const oldestRelevant = bucket.timestamps[bucket.timestamps.length - maxFailures]
    const expiresAt = oldestRelevant + windowMs
    const remainingMs = Math.max(0, expiresAt - now)
    return Math.max(1, Math.ceil(remainingMs / 1000))
  }

  function getKeys(email: string, ip: string | undefined): [string, string] {
    return [emailIpKey(email, ip), emailKey(email)]
  }

  return {
    check(email: string, ip: string | undefined, now: number = Date.now()): ThrottleCheckResult {
      for (const key of getKeys(email, ip)) {
        const bucket = buckets.get(key)
        if (bucket) {
          pruneBucket(bucket, now)
          bucket.lastAccessed = now
          if (bucket.timestamps.length >= maxFailures) {
            return { allowed: false, retryAfterSeconds: getRetryAfter(bucket, now) }
          }
        }
      }

      return { allowed: true }
    },

    recordFailure(email: string, ip: string | undefined, now: number = Date.now()): void {
      const keys = getKeys(email, ip)
      let needed = 0
      for (const key of keys) {
        if (!buckets.has(key)) {
          needed++
        }
      }
      ensureCapacity(now, needed)

      for (const key of keys) {
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = { timestamps: [], lastAccessed: now }
          buckets.set(key, bucket)
        }
        pruneBucket(bucket, now)
        bucket.timestamps.push(now)
        bucket.lastAccessed = now
      }
    },

    recordSuccess(email: string, ip: string | undefined): void {
      const eipK = emailIpKey(email, ip)
      buckets.delete(eipK)
    },

    size(): number {
      return buckets.size
    }
  }
}
