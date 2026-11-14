import { useRef, useState } from "react";

type Project = { id: string; name: string };
type ImportState = "idle" | "checking" | "ready" | "signed-out" | "denied" | "uploading" | "saved" | "uncertain";

/** This control only sends file bytes after an explicit project choice and upload click. */
export function LocalImport({ blob, filename, operation, onBusyChange, format = "mp4" }: { blob: Blob; filename: string; operation: string; onBusyChange: (busy: boolean) => void; format?: "mp4" | "wav" }) {
  const media = format === "wav" ? { label: "WAV", mime: "audio/wav", limit: 32 } : { label: "MP4", mime: "video/mp4", limit: 64 };
  const [state,setState] = useState<ImportState>("idle");
  const [projects,setProjects] = useState<Project[]>([]), [project,setProject] = useState("");
  const [message,setMessage] = useState(""), [asset,setAsset] = useState("");
  const lock = useRef(false), attempted = useRef(false);
  const identity = useRef("");
  async function checkAccess() {
    if (lock.current || attempted.current) return;
    lock.current = true; setState("checking"); setMessage(""); setProjects([]); setProject("");
    try {
      const response = await fetch("/api/session", {credentials:"same-origin",cache:"no-store"});
      if (!response.ok) throw new Error("Could not check the Studio session.");
      const session = await response.json();
      if (!session.signedIn) { setState("signed-out"); return; }
      if (!Array.isArray(session.actions) || !session.actions.includes("read") || !session.actions.includes("edit")) { setState("denied"); setMessage("This session needs read and edit access to import. Reopen a permitted project in Studio."); return; }
      if (typeof session.localImportBinding !== "string" || !/^[a-f0-9]{64}$/.test(session.localImportBinding)) throw new Error("Could not bind this import to the current Studio session.");
      identity.current = session.localImportBinding;
      const listing = await fetch("/api/state", {credentials:"same-origin",cache:"no-store"});
      if (listing.status === 401) { setState("signed-out"); return; }
      if (!listing.ok) throw new Error("Could not load permitted studios. Check your access and try again.");
      const data = await listing.json();
      if (!Array.isArray(data.projects)) throw new Error("Could not load permitted studios.");
      const available: Project[] = data.projects.filter((p: Project) => typeof p.id === "string" && /^prj_[a-z0-9_]+$/.test(p.id) && typeof p.name === "string").map((p: Project) => ({id:p.id,name:p.name}));
      setProjects(available); setState("ready");
      if (!available.length) setMessage("No accessible studios found. Open Studio to create one or check your access.");
    } catch (error) { setState("idle"); setMessage(error instanceof Error ? error.message : "Could not check Studio access."); }
    finally { lock.current = false; }
  }
  async function upload() {
    if (lock.current || attempted.current || state !== "ready" || !projects.some(p=>p.id===project)) return;
    lock.current = true; setState("uploading"); onBusyChange(true); setMessage("");
    try {
      const sessionResponse = await fetch("/api/session", {credentials:"same-origin",cache:"no-store"});
      const current = sessionResponse.ok ? await sessionResponse.json() : null;
      if (!current?.signedIn || !Array.isArray(current.actions) || !current.actions.includes("edit") || current.localImportBinding !== identity.current) {
        setState("idle"); setMessage("Your Studio session changed. Check sign-in and choose a studio again."); return;
      }
      if (!blob.size || blob.size > media.limit * 1024 * 1024) { setState("ready"); setMessage(`Studio accepts ${media.label} files up to ${media.limit} MiB. Save this result locally or make a smaller clip.`); return; }
      const form = new FormData(); form.set("file", new File([blob],filename,{type:media.mime}));
      form.set("title", filename.replace(/\.[^.]+$/, "").slice(0,100));
      form.set("caption", `Edited on this device with Media Studio ${operation}. Source files were not uploaded by this tool.`);
      attempted.current = true;
      const response = await fetch(`/api/projects/${encodeURIComponent(project)}/assets`, {method:"POST",credentials:"same-origin",headers:{"x-studio-local-import-binding":identity.current},body:form});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !/^asset_[a-z0-9_]+$/.test(data?.asset?.id ?? "")) throw new Error("Studio did not confirm the import.");
      setAsset(data.asset.id); setState("saved"); setMessage("Imported as a new private library asset. Your local result and originals are unchanged.");
    } catch (error) {
      if (attempted.current) { setState("uncertain"); setMessage("We could not confirm the import. Check the selected Studio library before trying again; your local download is still available."); }
      else { setState("ready"); setMessage(error instanceof Error ? error.message : "Could not read the local result."); }
    } finally { lock.current = false; onBusyChange(false); }
  }
  return <details className="local-import"><summary>Import to Studio</summary>
    <p className="trim-note">Optional: sign in and choose a studio, then explicitly upload this finished {media.label}. Your source files stay on this device. Opening this section does not upload anything.</p>
    {(state === "idle" || state === "signed-out" || state === "denied") && <><button type="button" className="secondary" onClick={()=>void checkAccess()}>Check sign-in and studios</button>{(state === "signed-out" || state === "denied") && <p>Open <a href="/studio" target="_blank" rel="noopener noreferrer">Studio sign-in in a new tab</a>, then return here and check again. Keep this page open to retain your result.</p>}</>}
    {state === "checking" && <p>Checking Studio access…</p>}
    {(state === "ready" || state === "uploading") && <><label className="trim-file">Destination studio<select value={project} disabled={state === "uploading"} onChange={e=>setProject(e.target.value)}><option value="">Choose a studio</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><button type="button" className="secondary" disabled={!project || state === "uploading"} onClick={()=>void upload()}>{state === "uploading" ? "Uploading…" : `Upload ${media.label} to selected studio`}</button></>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {state === "uncertain" && project && <p><a href={`/#/p/${encodeURIComponent(project)}/library`} target="_blank" rel="noopener noreferrer">Check the selected library</a></p>}
    {state === "saved" && <p><a href={`/#/a/${encodeURIComponent(project)}/${encodeURIComponent(asset)}`} target="_blank" rel="noopener noreferrer">Open imported {format === "wav" ? "audio" : "video"} in Studio</a></p>}
  </details>;
}
