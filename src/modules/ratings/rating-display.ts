export type PublicRatingDto = {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  serviceId: string | null;
  serviceName: string | null;
  reviewerDisplayName: string;
};

export function maskFirstName(firstName: string | null | undefined): string {
  const name = (firstName ?? '').trim();
  if (!name) return '**';
  const visible = name.slice(0, 2);
  return visible + '*'.repeat(Math.max(0, name.length - visible.length));
}

export function toPublicRatingDto(input: {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  serviceId: string | null;
  serviceName?: string | null;
  reviewerFirstName: string | null | undefined;
}): PublicRatingDto {
  return {
    id: input.id,
    score: input.score,
    comment: input.comment,
    createdAt: input.createdAt,
    serviceId: input.serviceId,
    serviceName: input.serviceName ?? null,
    reviewerDisplayName: maskFirstName(input.reviewerFirstName),
  };
}
