import { useEffect, useRef, useState } from 'react';
import type { MediaAssetV1 } from './contracts';
import { previewSceneDirections, type DirectionMode } from './scene-direction';
import { previewSceneReferences } from './scene-reference';
import { createSubjectPack, readSubjectPack } from './subject-pack.mjs';

type Scene = { id: string; direction: string; referenceAssetId: string | null };
type Subject = { id: string; revision: number; type: string; name: string; traits: string; referenceAssetId: string; referenceSha256: string; referenceRole: string; referenceAvailable: boolean };
type Form = { type: string; name: string; traits: string; referenceAssetId: string; referenceRole: string; rightsConfirmed: boolean };
type EditTarget = { id: string; revision: number; name: string };
type Proposal = { selectedIds: string[]; directionMode: DirectionMode; referenceMode: 'keep' | 'set' };
const blankForm = (): Form => ({ type: 'person', name: '', traits: '', referenceAssetId: '', referenceRole: 'face', rightsConfirmed: false });
const blankProposal = (): Proposal => ({ selectedIds: [], directionMode: 'append', referenceMode: 'keep' });
const drafts = new Map<string, { form: Form; proposal: Proposal; editTarget: EditTarget | null }>();
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message ?? `Request failed (${response.status})`) as Error & { status?: number }; error.status = response.status; throw error; }
  return data;
}
function direction(subject: Subject) { return `${subject.name}${subject.traits.trim() ? `: ${subject.traits.trim()}` : ''}`; }
function changes(scenes: Scene[], subject: Subject, proposal: Proposal, images: MediaAssetV1[]) {
  if (!subject.referenceAvailable || !images.some(image => image.id === subject.referenceAssetId && image.kind === 'image')) return { error: 'The saved reference is no longer available in this studio.', edits: [] };
  const directions = previewSceneDirections(scenes, proposal.selectedIds, direction(subject), proposal.directionMode);
  if (directions.error) return { error: directions.error, edits: [] };
  const refs = proposal.referenceMode === 'set' ? previewSceneReferences(scenes, proposal.selectedIds, 'set', subject.referenceAssetId, images.filter(image => image.kind === 'image').map(image => image.id)) : null;
  if (refs?.error) return { error: refs.error, edits: [] };
  return { error: '', edits: directions.edits.map(edit => ({ ...edit, beforeRef: scenes.find(scene => scene.id === edit.id)?.referenceAssetId ?? null, afterRef: refs ? refs.edits.find(item => item.id === edit.id)!.after : scenes.find(scene => scene.id === edit.id)?.referenceAssetId ?? null })) };
}

export function SubjectLibrary({ projectId, planId, scenes, images, canEdit, conflict, onApply }: { projectId: string; planId: string | null; scenes: Scene[]; images: MediaAssetV1[]; canEdit: boolean; conflict: boolean; onApply: (subject: Subject, proposal: Proposal) => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/subjects`;
  const cached = drafts.get(projectId);
  const [form, setForm] = useState<Form>(cached?.form ?? blankForm());
  const [proposal, setProposal] = useState<Proposal>(cached?.proposal ?? blankProposal());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(cached?.editTarget ?? null);
  const latest = useRef({ form, proposal, editTarget }); latest.current = { form, proposal, editTarget };
  useEffect(() => () => { drafts.set(projectId, structuredClone(latest.current)); }, [projectId]);
  useEffect(() => { if (!(form.name || form.traits || form.referenceAssetId)) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [form.name, form.traits, form.referenceAssetId]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [versions, setVersions] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(Boolean(cached?.form.name || cached?.form.traits || cached?.form.referenceAssetId));
  const [preview, setPreview] = useState<Subject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { let active = true; request(base).then(data => { if (active) setSubjects(data.subjects); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [base]);
  useEffect(() => { setPreview(null); setProposal(current => ({ ...current, selectedIds: [] })); }, [planId]);
  const chosen = versions.find(item => item.revision === revision);
  const checkKey = useRef('');
  checkKey.current = JSON.stringify({ planId, scenes, proposal, subjectId, revision, conflict });
  const photo = images.find(image => image.id === chosen?.referenceAssetId);
  const label = (id: string | null) => id ? images.find(image => image.id === id)?.title ?? 'Unavailable still' : 'No reference';
  async function selectSubject(id: string) {
    setSubjectId(id); setVersions([]); setRevision(0); setPreview(null); setError('');
    if (!id) return;
    setBusy(true); try { const data = await request(`${base}/${encodeURIComponent(id)}`); setVersions(data.versions); setRevision(data.versions[0]?.revision ?? 0); if (data.versions[0]) setSubjects(current => [data.versions[0], ...current.filter(item => item.id !== id)]); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request(editTarget ? `${base}/${encodeURIComponent(editTarget.id)}` : base, editTarget ? 'PATCH' : 'POST', { ...form, ...(editTarget ? { expectedRevision: editTarget.revision } : {}) });
      setSubjects(current => [data.subject, ...current.filter(subject => subject.id !== data.subject.id)]); setForm(blankForm()); setEditTarget(null); setFormOpen(false); await selectSubject(data.subject.id); setMessage('Subject version saved in this studio.');
    } catch (e) { const err = e as Error & { status?: number }; setError(err.status === 409 ? 'This subject changed elsewhere. Your form is still here; copy your edits before starting a new version from the latest subject.' : err.message); } finally { setBusy(false); }
  }
  function downloadPack() {
    if (!chosen) return;
    const pack = createSubjectPack(chosen);
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'media-studio-subject.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Subject pack download requested. It contains private text, the subject ID, version and source fingerprint, but no image.');
  }
  async function importPack(file: File | undefined) {
    if (!file) return;
    setError(''); setMessage('');
    const originalForm = JSON.stringify(latest.current.form);
    try {
      if (file.size > 16384) throw new Error('Subject pack is too large. Choose a pack smaller than 16 KB.');
      const subject = readSubjectPack(JSON.parse(await file.text()));
      if (JSON.stringify(latest.current.form) !== originalForm) throw new Error('The subject form changed while the pack was loading. Try importing again.');
      if ((form.name || form.traits || form.referenceAssetId) && !window.confirm('Replace the unfinished subject form with this pack?')) return;
      setForm(subject); setEditTarget(null); setFormOpen(true);
      setMessage('Pack loaded as a new draft. Choose a still in this studio and confirm permission before saving. The saved subject will not retain the pack’s source details; keep the file for provenance.');
    } catch (e) { setError(e instanceof SyntaxError ? 'This file is not valid JSON.' : (e as Error).message); }
  }
  async function checkVersion() {
    if (!chosen) throw new Error('Choose a subject version.');
    const data = await request(`${base}/${encodeURIComponent(chosen.id)}`);
    const fresh: Subject | undefined = data.versions.find((item: Subject) => item.revision === chosen.revision);
    if (!fresh || !fresh.referenceAvailable) throw new Error('This version’s reference is no longer available. Choose another version.');
    const result = changes(scenes, fresh, proposal, images); if (result.error) throw new Error(result.error);
    return fresh;
  }
  const result = preview ? changes(scenes, preview, proposal, images) : null;
  return <details className="subject-library"><summary>Subject library</summary><p className="small">Keep project-owned reference stills and creator-written traits together. Applying a version changes only your scene draft; it does not generate media or guarantee an identity.</p>
    {error && <p role="alert" className="notice">{error}</p>}{message && <p role="status" className="notice calm">{message}</p>}
    <div className="song-plan-columns"><div><h4>Saved subjects</h4><label>Subject<select value={subjectId} disabled={busy} onChange={event => void selectSubject(event.target.value)}><option value="">Choose a subject</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name} · {subject.type} · v{subject.revision}</option>)}</select></label>
      {chosen && <><label>Version<select disabled={busy} value={revision} onChange={event => { setRevision(Number(event.target.value)); setPreview(null); }}>{versions.map(version => <option key={version.revision} value={version.revision}>Version {version.revision}{version.referenceAvailable ? '' : ' · reference unavailable'}</option>)}</select></label><div className="subject-summary">{photo && chosen.referenceAvailable && <img src={photo.file} alt={`Reference still for ${chosen.name}`} loading="lazy"/>}<div><strong>{chosen.name}</strong><p>{chosen.traits || 'No traits added.'}</p><p className="small">{chosen.type} · {chosen.referenceRole} · {chosen.referenceAvailable && photo ? label(chosen.referenceAssetId) : 'Reference unavailable'}</p></div></div><button type="button" className="secondary" disabled={!canEdit || busy} onClick={() => { const current = versions[0]; if ((form.name || form.traits || form.referenceAssetId) && !window.confirm('Discard the unfinished subject form and start a new version?')) return; setForm({ type: current.type, name: current.name, traits: current.traits, referenceAssetId: current.referenceAssetId, referenceRole: current.referenceRole, rightsConfirmed: false }); setEditTarget({ id: current.id, revision: current.revision, name: current.name }); setFormOpen(true); }}>Make a new version</button> <button type="button" className="secondary" title="Download private subject text, ID, version and reference fingerprint; no image" onClick={downloadPack}>Download subject pack</button></>}
    </div><div><details><summary>Import a subject pack</summary><p className="small">A pack copies subject text only. It does not include the image or grant permission. Choose a still from this studio and confirm your rights before saving.</p><label>Subject pack JSON<input type="file" accept="application/json,.json" disabled={!canEdit || busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importPack(file); }}/></label></details><details open={formOpen} onToggle={event => setFormOpen(event.currentTarget.open)}><summary>{editTarget ? `New version of ${editTarget.name} (from v${editTarget.revision})` : 'Save a subject'}</summary><form className="stack" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={!canEdit || busy}><label>Type<select value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}>{['person','product','location','style','source_frame'].map(type => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</select></label><label>Name<input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Traits<textarea maxLength={1200} value={form.traits} onChange={event => setForm({ ...form, traits: event.target.value })}/></label><label>Reference still<select required value={form.referenceAssetId} onChange={event => setForm({ ...form, referenceAssetId: event.target.value, rightsConfirmed: false })}><option value="">Choose a still from this studio</option>{images.map(image => <option key={image.id} value={image.id}>{image.title}</option>)}</select></label><label>Reference role<select value={form.referenceRole} onChange={event => setForm({ ...form, referenceRole: event.target.value })}>{['face','full_body','profile','costume','prop','location','style','source_frame'].map(role => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}</select></label><label className="song-check"><input type="checkbox" checked={form.rightsConfirmed} required onChange={event => setForm({ ...form, rightsConfirmed: event.target.checked })}/> I own this still or have permission to use it as a reference.</label><button type="submit" disabled={!form.rightsConfirmed || !form.referenceAssetId}>{editTarget ? 'Save new version' : 'Save subject'}</button>{editTarget && <button type="button" className="quiet" onClick={() => { if ((form.name || form.traits || form.referenceAssetId) && !window.confirm('Discard this unfinished subject version?')) return; setEditTarget(null); setForm(blankForm()); }}>Cancel version</button>}</fieldset></form></details></div></div>
    {planId && chosen && <div className="scene-direction-editor"><h4>Use version {chosen.revision} in scenes</h4><p className="small">Choose scenes, review each direction and reference, then apply to the unsaved plan. This copies the text and chosen still and records the subject version as private scene history. Later edits may change the scene; the record does not guarantee likeness. Selected takes and timing remain unchanged.</p><fieldset disabled={!canEdit || busy} className="scene-direction-selection"><legend>Scenes to change</legend>{scenes.map((scene, index) => <label key={scene.id} className="song-check"><input type="checkbox" checked={proposal.selectedIds.includes(scene.id)} onChange={event => { const checked = event.currentTarget.checked; setProposal(current => ({ ...current, selectedIds: checked ? [...current.selectedIds, scene.id] : current.selectedIds.filter(id => id !== scene.id) })); setPreview(null); }}/> Scene {index + 1}</label>)}</fieldset><label>Direction<select disabled={busy} value={proposal.directionMode} onChange={event => { setProposal({ ...proposal, directionMode: event.target.value as DirectionMode }); setPreview(null); }}><option value="append">Add name and traits</option><option value="replace">Replace with name and traits</option></select></label><label>Scene reference<select disabled={busy} value={proposal.referenceMode} onChange={event => { setProposal({ ...proposal, referenceMode: event.target.value as 'keep' | 'set' }); setPreview(null); }}><option value="keep">Keep each current reference</option><option value="set">Use this version’s reference</option></select></label><button type="button" className="secondary" disabled={!canEdit || busy || conflict} onClick={() => { const key = checkKey.current; setBusy(true); setError(''); void checkVersion().then(fresh => { if (checkKey.current !== key) throw new Error('The plan or selection changed. Preview again.'); setPreview(fresh); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Preview subject changes</button>
      {result && <div className="scene-direction-preview" aria-live="polite">{result.error ? <p>{result.error}</p> : <><ol>{result.edits.map(edit => <li key={edit.id}><strong>Scene {scenes.findIndex(scene => scene.id === edit.id) + 1}</strong><dl><dt>Direction before</dt><dd>{edit.before || 'No direction'}</dd><dt>Direction after</dt><dd>{edit.after}</dd><dt>Reference before</dt><dd>{label(edit.beforeRef)}</dd><dt>Reference after</dt><dd>{label(edit.afterRef)}</dd></dl></li>)}</ol><button type="button" disabled={busy || conflict} onClick={() => { const key = checkKey.current; setBusy(true); setError(''); void checkVersion().then(fresh => { if (checkKey.current !== key) throw new Error('The plan or selection changed. Preview again.'); onApply(fresh, proposal); setPreview(null); setProposal(blankProposal()); setMessage('Subject applied to your draft. Save the scene plan when ready.'); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Apply to scene draft</button></>}</div>}
    </div>}
  </details>;
}
export { changes as previewSubjectChanges };
