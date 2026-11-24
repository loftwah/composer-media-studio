export type SavedCutListPlan = {
  title: string;
  revision: number;
  scenes: readonly { sourceStartMs: number; sourceEndMs: number }[];
};

type SourceDisplayName = { title: string };

const singleLine = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ');

/** Portable text deliberately reads only display names and saved source times. */
export function savedCutListText(plan: SavedCutListPlan, source: SourceDisplayName): string {
  return [
    `Title: ${singleLine(plan.title)}`,
    `Revision: ${plan.revision}`,
    `Source: ${singleLine(source.title)}`,
    'Timing: original source, milliseconds',
    ...plan.scenes.map((scene, index) => `Scene ${index + 1} · ${scene.sourceStartMs}–${scene.sourceEndMs} ms`),
  ].join('\n');
}
