import { SessionManager } from './SessionManager';
import { rootLogger } from './Logger';
import { ensureDir } from './Utils';
import { BASE_DIR, SESSIONS_DIR, LOGS_DIR, CACHE_DIR, QR_CACHE_DIR } from './Constants';
import { OfficialSessionManager } from './backends/OfficialSessionManager';

let bootstrapped = false;

/**
 * Called once when the package is first imported.
 * Creates required directories and restores persisted sessions.
 */
export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  // Ensure directory structure
  for (const dir of [BASE_DIR, SESSIONS_DIR, LOGS_DIR, CACHE_DIR, QR_CACHE_DIR]) {
    ensureDir(dir);
  }

  rootLogger.info('Bootstrap: starting session restore');
  try {
    await SessionManager.getInstance().restoreAll();
    rootLogger.info('Bootstrap: session restore complete');
  } catch (err) {
    rootLogger.error('Bootstrap: session restore failed', err);
  }

  // Additive: also restore any persisted Official Baileys sessions.
  // This is independent of, and cannot affect, the legacy restore above.
  try {
    await OfficialSessionManager.getInstance().restoreAll();
  } catch (err) {
    rootLogger.error('Bootstrap: official-backend session restore failed', err);
  }
}

// Auto-run on import
bootstrap().catch(err => {
  console.error('[WhatsApp Baileys] Bootstrap failed:', err);
});
