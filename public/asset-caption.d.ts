export function isLocalRenderProvenance(caption: string | null | undefined): boolean;
export function publicCaption(caption: string | null | undefined): string;

export function shareImportProvenance(caption: string | null | undefined): { catalogue: string; source: string | null; credit: string } | null;
