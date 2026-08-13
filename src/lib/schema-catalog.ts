type InvalidateFn = (database?: string) => void;

let invalidateImpl: InvalidateFn = () => {};

export function registerSchemaCatalogInvalidator(fn: InvalidateFn) {
  invalidateImpl = fn;
}

export function invalidateSchemaCatalog(database?: string) {
  invalidateImpl(database);
}
