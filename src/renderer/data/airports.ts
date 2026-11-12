import data from './airports.json';

export type Airport = [string, string, string, number, number, number | null, string, string, 'L' | 'M'];
export const AIRPORTS = (data as unknown as { airports: Airport[] }).airports;
