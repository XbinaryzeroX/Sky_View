// QA dependency resolution only. This does not add Playwright to the application package.
// Prefer the local QA environment; ATLAS_QA_NODE_MODULES can point to an external node_modules directory.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
function loadPlaywrightRuntime() {
  const local = createRequire(import.meta.url);
  const candidates = [local];
  if (process.env.ATLAS_QA_NODE_MODULES) {
    candidates.unshift(createRequire(join(resolve(process.env.ATLAS_QA_NODE_MODULES), "__atlas_qa_resolver__.cjs")));
  }
  for (const require2 of candidates) {
    try {
      return { electron: require2("playwright-core")._electron, version: require2("playwright-core/package.json").version };
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Playwright QA runtime unavailable. Set ATLAS_QA_NODE_MODULES to an external node_modules directory containing playwright-core, or supply it in the local QA environment.");
}
export {
  loadPlaywrightRuntime
};
