// -------------------------------------------------------------------
// Test stub for the `server-only` package.
//
// `import "server-only"` throws if a module is pulled into a client bundle,
// which is exactly what it is for - but it also means a Vitest run cannot
// import any service, repository or lib module that uses it, because there
// is no bundler in front of it to resolve the package.
//
// vitest.config.ts aliases the package to this file so those modules can be
// unit-tested directly. It changes nothing about the real build: Next still
// resolves the real package, and the guard still fires there.
// -------------------------------------------------------------------
export {};
