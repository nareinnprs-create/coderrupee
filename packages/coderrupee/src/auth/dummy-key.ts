// Kept dependency-free: plugin sources that bundle for the Node runtime
// (e.g. test/plugin/azure.test.ts's single-file build) import this constant,
// and dragging the full auth service (jsonc-parser's UMD require) into the
// bundle breaks under Node.
export const OAUTH_DUMMY_KEY = "coderrupee-oauth-dummy-key"
