/**
 * Keyfile import/export utilities
 * Plain JSON format for backup/restore
 */

export interface Keyfile {
  version: string;
  mnemonic: string;
  created: string;
}

/**
 * Export mnemonic to plain JSON keyfile.
 *
 * This legacy format is intentionally retained for backwards compatibility.
 * Callers must only expose it through an explicit user action.
 */
export function exportKeyfile(mnemonic: string): Keyfile {
  return {
    version: '1',
    mnemonic,
    created: new Date().toISOString(),
  };
}

/**
 * Import keyfile to get mnemonic
 */
export function importKeyfile(keyfile: Keyfile): string {
  // Validate keyfile format
  if (!keyfile.version) {
    throw new Error('Invalid keyfile format: missing version');
  }

  if (keyfile.version !== '1') {
    throw new Error('Unsupported keyfile version');
  }

  if (!keyfile.mnemonic || typeof keyfile.mnemonic !== 'string') {
    throw new Error('Invalid keyfile format: missing or invalid mnemonic');
  }

  return keyfile.mnemonic;
}

/**
 * Download keyfile as JSON file
 */
export function downloadKeyfile(keyfile: Keyfile, filename: string = 'nockchain-keyfile.json') {
  const json = JSON.stringify(keyfile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
