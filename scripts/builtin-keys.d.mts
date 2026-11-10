export type BuiltinKeys = Partial<Record<'google3d' | 'twelvedata' | 'alphavantage', string>>;
export function parseBuiltinKeys(raw: string): BuiltinKeys;
export function loadBuiltinKeys(path?: string): Promise<BuiltinKeys>;
export function obfuscateBuiltinKeys(keys: BuiltinKeys): string;
