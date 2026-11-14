import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { HomeProps, ProjectSummaryV1 } from "./contracts";
import "./home.css";

const money = (micro: number) => {
  const amount = Number(micro ?? 0) / 1_000_000;
  return amount === 0 ? "$0.00" : amount < 0.01 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`;
};
const count = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;

function ProjectCard({ project, featured }: { project: ProjectSummaryV1; featured: boolean }) {
  const description = [count(project.counts.image, "image"), count(project.counts.video, "video"), count(project.counts.audio, "sound")].join(" · ");
  return <button type="button" className={`creative-project${featured ? " creative-project-featured" : ""}`} data-action="open-project" data-id={project.id}>
    <span className="creative-cover">
      {project.cover ? <img src={project.cover} alt="" loading={featured ? "eager" : "lazy"} /> : <span className="creative-empty" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>}
    </span>
    <span className="creative-project-body">
      <span className="creative-project-title">{project.name}</span>
      {featured && project.creativeDirection && <span className="creative-direction">{project.creativeDirection}</span>}
      <span className="creative-meta">{description}</span>
      <span className="creative-budget">{money(project.budget.spentMicro)} of {money(project.budget.allowanceMicro)} used this month</span>
      <span className="creative-open">Open studio <span aria-hidden="true">→</span></span>
    </span>
  </button>;
}

function Home({ projects, videosConfigured, woodhouseShare }: HomeProps) {
  return <div className="creative-home">
    <header className="creative-intro">
      <div><h1>Your creative work, together.</h1><p>Pick up a project, refine an image, make a film or bring sound into the mix.</p></div>
      <button type="button" className="button" data-action="new-project">New studio</button>
    </header>
    {projects.length > 0 ? <section aria-labelledby="creative-projects">
      <div className="creative-section-head"><h2 id="creative-projects">Your studios</h2><span>{count(projects.length, "project")}</span></div>
      <div className="creative-grid">{projects.map((project, index) => <ProjectCard key={project.id} project={project} featured={index === 0} />)}</div>
    </section> : <section className="creative-blank"><h2>Start with an idea</h2><p>Add your own images, video or sound, then create and save new work alongside them.</p><button type="button" className="button" data-action="new-project">Create your first studio</button></section>}
    <section className="creative-paths" aria-label="Explore the studio">
      <div><h2>Make something new</h2><p>Choose a project to create, edit, animate, mix and publish. You’ll see an estimate before any paid generation.</p></div>
      <div className="creative-path-links tw:flex tw:flex-wrap tw:gap-2">{woodhouseShare && <a className="button secondary" href="/portfolio">Browse Share artwork</a>}<a className="button secondary" href="/help" target="_blank" rel="noopener noreferrer">Explore studio tools</a></div>
      {projects[0] && <div className="creative-shortcuts"><span>Start in {projects[0].name}</span><div className="creative-path-links"><a className="button secondary" href={`#/p/${encodeURIComponent(projects[0].id)}/create`}>Create and refine</a><a className="button secondary" href={`#/p/${encodeURIComponent(projects[0].id)}/assemble`}>Build a storyboard</a><a className="button secondary" href={`#/p/${encodeURIComponent(projects[0].id)}/library`}>Open the library</a></div></div>}
      <p className="creative-provider">{videosConfigured ? "Video generation is configured; the provider checks funding on submit." : "Video generation needs a fal.ai key on this studio."} Uploads, the library and publishing work without a model account.</p>
    </section>
  </div>;
}

let root: Root | undefined;
export function renderHome(container: HTMLElement, props: HomeProps): void {
  root ??= createRoot(container);
  flushSync(() => root!.render(<Home {...props} />));
}
export function unmountHome(): void {
  if (root) { root.unmount(); root = undefined; }
}

export { renderLibrary, renderViewer, renderCreate, renderHistory, renderPublish, unmountMedia } from "./library";
