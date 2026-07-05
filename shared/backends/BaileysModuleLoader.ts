/**
 * Official Baileys (npm package `baileys`, v7+) ships as pure ESM
 * (`"type": "module"`, no `require` entry point / dual-package `exports`).
 * This package compiles to CommonJS (see tsconfig.json — unchanged, to
 * avoid a much larger, riskier migration of the whole build). A CJS
 * module cannot `require()` a pure-ESM package directly.
 *
 * The robust, version-independent fix is a *dynamic* `import()` — Node's
 * CommonJS loader is able to `import()` ESM packages regardless of Node
 * version, without relying on the newer (and initially experimental)
 * `require(esm)` support. We do this lazily and cache the result so the
 * cost is paid once per process.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BaileysModule = any;

let cached: Promise<BaileysModule> | undefined;

export function loadOfficialBaileys(): Promise<BaileysModule> {
  if (!cached) {
    // The indirection through `Function` prevents TypeScript's CommonJS
    // module target from rewriting `import()` into a `require()` call,
    // which would defeat the whole point (and throw ERR_REQUIRE_ESM).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<BaileysModule>;
    cached = dynamicImport('@whiskeysockets/baileys').catch(err => {
      cached = undefined; // allow retry on next call instead of caching a permanent failure
      throw new Error(
        `Failed to load the official "@whiskeysockets/baileys" package. Make sure it is installed ` +
          `alongside this node package (npm install @whiskeysockets/baileys). Original error: ${
            (err as Error).message
          }`,
      );
    });
  }
  return cached;
}
