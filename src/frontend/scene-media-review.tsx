import { useState } from 'react';
import type { MediaAssetV1 } from './contracts';

type Props = { index: number; referenceId: string | null; takeId: string | null; assets: MediaAssetV1[] };

function SceneStill({ asset }: { asset: MediaAssetV1 }) {
  const [failed, setFailed] = useState(false);
  return <>{failed ? <p role="status">This still could not load. Check it in the library.</p> : <img src={asset.file} alt={`Reference still: ${asset.title}`} loading="lazy" onError={() => setFailed(true)} />}<p>{asset.title}</p></>;
}
function SceneTake({ asset, index }: { asset: MediaAssetV1; index: number }) {
  const [failed, setFailed] = useState(false);
  return <>{failed ? <p role="status">This take could not load. Check it in the library.</p> : <video controls playsInline preload="none" src={asset.file} aria-label={`Selected take for scene ${index + 1}: ${asset.title}`} onError={() => setFailed(true)} />}<p>{asset.title}</p></>;
}

/** Preview only assets already available in this project; never changes a scene. */
export function SceneMediaReview({ index, referenceId, takeId, assets }: Props) {
  const [open, setOpen] = useState(false);
  const reference = assets.find(asset => asset.id === referenceId && asset.kind === 'image');
  const take = assets.find(asset => asset.id === takeId && asset.kind === 'video');
  return <details className="scene-media-review" onToggle={event => {
    if (!event.currentTarget.open) event.currentTarget.querySelector('video')?.pause();
    setOpen(event.currentTarget.open);
  }}>
    <summary>Review scene {index + 1} media</summary>
    {open && <div className="scene-media-grid">
      <div><strong>Reference still</strong>{reference ? <SceneStill key={reference.id} asset={reference} /> : <p>{referenceId ? 'This reference is unavailable in this studio.' : 'No reference selected.'}</p>}</div>
      <div><strong>Selected take</strong>{take ? <SceneTake key={take.id} asset={take} index={index} /> : <p>{takeId ? 'This take is unavailable in this studio.' : 'No take selected.'}</p>}</div>
      <p className="small">These are the current selections in your draft. Previewing does not save, generate or render.</p>
    </div>}
  </details>;
}
