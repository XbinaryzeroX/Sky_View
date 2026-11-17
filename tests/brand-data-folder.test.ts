// The visible brand is Sky_View, but the data folder keeps its former name so existing installs load their data.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the Atlas Watch data folder and the same appId after the rename to Sky_View', () => {
  const main = readFileSync('src/main/main.ts', 'utf8');
  expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'Atlas Watch'))");
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { productName: string; name: string };
  expect(pkg.productName).toBe('Sky_View');
  expect(pkg.name).toBe('atlas-watch');
  const builder = readFileSync('electron-builder.yml', 'utf8');
  expect(builder).toMatch(/^appId: app\.atlaswatch\.desktop$/m);
  expect(builder).toMatch(/^productName: Sky_View$/m);
  expect(readFileSync('index.html', 'utf8')).toContain('<title>Sky_View</title>');
});
