type PackSubject = { id: string; revision: number; type: string; name: string; traits: string; referenceRole: string; referenceSha256: string };
export function createSubjectPack(subject: PackSubject): object;
export function readSubjectPack(input: unknown): { type: string; name: string; traits: string; referenceRole: string; referenceAssetId: string; rightsConfirmed: boolean };
