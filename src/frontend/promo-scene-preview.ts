export type PromoScene = { visual: string };
export type TargetScene = { id: string; direction: string };
export type PromoSceneEdit = { id: string; index: number; before: string; after: string };
export function previewPromoScenes(scenes: TargetScene[], promo: PromoScene[], mode: 'append' | 'replace'): { edits: PromoSceneEdit[]; error: string } {
  if (scenes.length !== promo.length || scenes.length < 2 || scenes.length > 6) return { edits: [], error: 'The brief and audio plan need the same number of scenes.' };
  if (new Set(scenes.map(scene=>scene.id)).size !== scenes.length) return { edits: [], error: 'The scene plan changed. Reopen it and try again.' };
  const edits=promo.flatMap((source,index)=>{ const direction=source.visual.trim(); if(!direction)return []; const target=scenes[index]; return [{id:target.id,index,before:target.direction,after:mode==='replace'?direction:`${target.direction}${target.direction?'\n':''}${direction}`}]; });
  if (!edits.length) return { edits: [], error: 'Add a visual idea to the saved brief first.' };
  if (edits.some(edit=>edit.after.length>1200)) return { edits: [], error: 'A direction would exceed 1,200 characters. Shorten it or use replace.' };
  return { edits, error: '' };
}
