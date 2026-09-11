export type AuthMode = 'demo' | 'production';

/**
 * Production is deliberately the safe default. Demo behavior requires both an
 * explicit build-time request and a development JS bundle; an OTA cannot turn
 * a production binary into demo merely by omitting or misspelling an env var.
 */
export function resolveAuthMode(value: string | undefined, isDevelopmentBuild: boolean): AuthMode {
  return value === 'demo' && isDevelopmentBuild ? 'demo' : 'production';
}
