/**
 * Browser shims for Node.js built-ins used by some provider modules.
 * Injected into the bundle via esbuild's inject option.
 */

// No Node.js built-ins are used in the provider modules since they all use
// window.fetch. This file is a placeholder for future-proofing.
export const process = { env: { NODE_ENV: 'production' } };
