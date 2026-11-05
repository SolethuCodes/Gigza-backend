/**
 * Kinds of talent hosts can book. Each service category (a "style", e.g.
 * Amapiano for DJs or Wedding Photography for photographers) belongs to one.
 * Stored as plain text on ServiceCategory.talentType; add new kinds here.
 */
export const TALENT_TYPES = ['DJ', 'MC', 'PHOTOGRAPHER', 'DANCER'] as const;

export type TalentType = (typeof TALENT_TYPES)[number];

export const DEFAULT_TALENT_TYPE: TalentType = 'DJ';
