import { randomBytes, webcrypto } from 'node:crypto'
import { createChallenge, verifySolution, pbkdf2 } from 'altcha/lib'

/**
 * ALTCHA PoW 人机验证（开源，github.com/altcha-org/altcha）。
 *
 * 流程：GET /api/auth/altcha-challenge 出题（带 HMAC 签名，服务端无状态）
 *  → 浏览器算力解题（widget 内置 worker）→ 登录请求带上 base64 payload
 *  → 这里验签 + 重算派生键。脚本直刷登录口每次都要白付一遍 PoW 算力。
 *
 * 兼容性：altcha/lib 依赖 WebCrypto 全局（crypto.subtle）。
 * Node 18 起已带实验性 globalThis.crypto（19 起稳定），线上 Node 18 可直接用；
 * 这里的兜底赋值只为消除更老环境的差异与实验告警，新 Node 上不会触发。
 */
if (!(globalThis as { crypto?: Crypto }).crypto) {
  ;(globalThis as { crypto?: Crypto }).crypto = webcrypto
}

// —— 参数（改动需同步权衡：解题时长 ≈ attempts × cost 次迭代）——
// PBKDF2/SHA-256 + cost=5000 + keyPrefix 默认 "00"（约 256 次尝试，8 bit 难度）：
// 真人浏览器解题约 0.5~2s（widget 有 ≥500ms 的最短展示动画），服务端单次校验 <1ms，
// 脚本每次登录尝试成本 ≈ 128 万次哈希迭代，叠加登录口既有的 20 次/5 分钟限流。
const ALGORITHM = 'PBKDF2/SHA-256'
const COST = 5_000
/** 挑战有效期（秒）：只覆盖"解题 + 提交"窗口，过期即作废 */
const CHALLENGE_TTL_SEC = 120

// 签名密钥：显式配置于 .env（ALTCHA_HMAC_KEY）；未配置时退化为进程级随机密钥，
// 只影响重启瞬间在途的挑战（作废重来），不影响功能——不学 SESSION_SECRET 的启动硬门槛。
const fallbackKey = randomBytes(32).toString('hex')
let fallbackWarned = false
function hmacSecret(): string {
  const fromEnv = process.env.ALTCHA_HMAC_KEY
  if (fromEnv && fromEnv.trim() !== '') return fromEnv
  if (process.env.NODE_ENV === 'production' && !fallbackWarned) {
    fallbackWarned = true
    console.warn('[altcha] 生产环境未配置 ALTCHA_HMAC_KEY，使用进程级随机密钥（重启会作废在途挑战）')
  }
  return fallbackKey
}

/** 出一道新题（供挑战路由直接返回） */
export function issueChallenge() {
  return createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    deriveKey: pbkdf2.deriveKey,
    hmacSignatureSecret: hmacSecret(),
    expiresAt: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC,
  })
}

// —— 一次性核销：同一挑战（nonce）验通过一次即记名，有效期内重放直接拒绝 ——
// 单实例 PM2 部署，内存版够用；键随过期时间惰性清扫，防膨胀。
const usedNonces = new Map<string, number>()
const SWEEP_THRESHOLD = 5_000

function burnNonce(nonce: string) {
  const expireMs = Date.now() + CHALLENGE_TTL_SEC * 1_000
  if (usedNonces.size > SWEEP_THRESHOLD) {
    const now = Date.now()
    for (const [k, v] of usedNonces) {
      if (v <= now) usedNonces.delete(k)
    }
  }
  usedNonces.set(nonce, expireMs)
}

export type AltchaCheck = 'ok' | 'required' | 'expired' | 'invalid'

/**
 * 校验登录请求携带的 altcha payload（widget 隐藏域：base64(JSON{challenge, solution})）。
 * 验通过即核销 nonce——无论后续口令对错，这道题都不能再用（错口令要重新解题）。
 */
export async function verifyLoginCaptcha(raw: unknown): Promise<AltchaCheck> {
  if (typeof raw !== 'string' || raw === '') return 'required'
  // payload 均为 ASCII（hex/数字/JSON 骨架），标准 base64 解码
  let parsed: any
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    return 'invalid'
  }
  const nonce = parsed?.challenge?.parameters?.nonce
  if (typeof nonce !== 'string' || nonce === '') return 'invalid'
  if (usedNonces.has(nonce)) return 'invalid' // 重放
  let result
  try {
    result = await verifySolution({
      challenge: parsed.challenge,
      solution: parsed.solution,
      deriveKey: pbkdf2.deriveKey,
      hmacSignatureSecret: hmacSecret(),
    })
  } catch {
    // 形状不合法等库内断言异常，一律按无效处理
    return 'invalid'
  }
  if (result.expired) return 'expired'
  if (!result.verified) return 'invalid'
  burnNonce(nonce)
  return 'ok'
}
