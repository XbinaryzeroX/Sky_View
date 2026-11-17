// Reads the one CSV inside a small publisher ZIP (GDELT's 15-minute exports) in memory, with size limits checked
// against the archive's declared sizes before anything is inflated.

import { unzipSync } from 'fflate';

export function unzipSingleCsv(bytes: Uint8Array, maxExpandedBytes: number): string {
  let declared = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (!/^[A-Za-z0-9_.-]{1,120}\.csv$/i.test(f.name)) return false;
      declared += f.originalSize;
      if (f.originalSize > maxExpandedBytes || declared > maxExpandedBytes) throw new Error('ZIP entry is larger than allowed');
      return true;
    },
  });
  const names = Object.keys(files);
  if (names.length !== 1) throw new Error('ZIP does not hold exactly one CSV file');
  const out = files[names[0]];
  // The declared size can lie; check what was actually inflated too.
  if (out.byteLength > maxExpandedBytes) throw new Error('ZIP entry is larger than allowed');
  return new TextDecoder('utf-8').decode(out);
}
