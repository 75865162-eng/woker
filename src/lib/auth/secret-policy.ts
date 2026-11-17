/**
 * 认证密钥策略：Edge 与 Node 共享，只含纯常量与纯函数，不引入任何 Node API。
 * 目的是让 middleware（Edge Runtime）与 session（Node）对 AUTH_SECRET 的判定完全一致。
 */

export const AUTH_SECRET_PLACEHOLDERS = new Set([
  "local-development-auth-secret",
  "change-this-local-secret-before-production",
  "replace-with-a-random-secret-at-least-32-characters",
]);

export const AUTH_SECRET_MIN_LENGTH = 32;

/** 生产环境的 AUTH_SECRET 必须是非占位符且长度足够的随机值。 */
export function isProductionAuthSecretValid(secret: string | undefined): boolean {
  return Boolean(
    secret &&
      !AUTH_SECRET_PLACEHOLDERS.has(secret) &&
      secret.length >= AUTH_SECRET_MIN_LENGTH,
  );
}
