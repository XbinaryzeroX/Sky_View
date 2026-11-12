import { z } from 'zod';

const assessment = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,160}$/),
  title: z.string().trim().min(1).max(160),
  region: z.string().trim().min(1).max(80),
  types: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  status: z.enum(['Developing', 'Improving', 'Unchanging', 'Worsening']),
});

export type ConflictAssessment = z.infer<typeof assessment>;
export function cfrOverviewUrl(id: string): string | null {
  return /^[a-z0-9-]{1,160}$/.test(id) ? 'https://www.cfr.org/global-conflict-tracker/conflict/' + id : null;
}
export type ConflictAssessments = {
  checkedAt: string | null;
  items: ConflictAssessment[];
  nextCheckAt: string;
  error: string | null;
};

const list = z.array(assessment).max(150);
export function validateAssessments(input: unknown): ConflictAssessment[] | null {
  const parsed = list.safeParse(input);
  if (!parsed.success || new Set(parsed.data.map(s => s.id)).size !== parsed.data.length) return null;
  return parsed.data;
}
