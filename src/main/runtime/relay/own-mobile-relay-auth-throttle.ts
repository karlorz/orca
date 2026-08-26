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

  return {
    check(email: string, ip: string | undefined, now: number = Date.now()): ThrottleCheckResult {
      const eipK = emailIpKey(email, ip)
      const eK = emailKey(email)

      const eipBucket = buckets.get(eipK)
      if (eipBucket) {
        pruneBucket(eipBucket, now)
        eipBucket.lastAccessed = now
        if (eipBucket.timestamps.length >= maxFailures) {
          return { allowed: false, retryAfterSeconds: getRetryAfter(eipBucket, now) }
        }
      }

      const eBucket = buckets.get(eK)
      if (eBucket) {
        pruneBucket(eBucket, now)
        eBucket.lastAccessed = now
        if (eBucket.timestamps.length >= maxFailures) {
          return { allowed: false, retryAfterSeconds: getRetryAfter(eBucket, now) }
        }
      }

      return { allowed: true }
    },

    recordFailure(email: string, ip: string | undefined, now: number = Date.now()): void {
      const eipK = emailIpKey(email, ip)
      const eK = emailKey(email)

      let needed = 0
      if (!buckets.has(eipK)) {
        needed++
      }
      if (!buckets.has(eK)) {
        needed++
      }
      ensureCapacity(now, needed)

      let eipBucket = buckets.get(eipK)
      if (!eipBucket) {
        eipBucket = { timestamps: [], lastAccessed: now }
        buckets.set(eipK, eipBucket)
      }
      pruneBucket(eipBucket, now)
      eipBucket.timestamps.push(now)
      eipBucket.lastAccessed = now

      let eBucket = buckets.get(eK)
      if (!eBucket) {
        eBucket = { timestamps: [], lastAccessed: now }
        buckets.set(eK, eBucket)
      }
      pruneBucket(eBucket, now)
      eBucket.timestamps.push(now)
      eBucket.lastAccessed = now
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
