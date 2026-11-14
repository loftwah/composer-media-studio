import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { HomeProps, ProjectSummaryV1 } from "./contracts";
import "./home.css";

const money = (micro: number) => {
  const n = Number(micro ?? 0) / 1_000_000;
  return n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
};
const count = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;
const counts = (p: ProjectSummaryV1) =>
  [
    count(p.counts.image, "image"),
    count(p.counts.video, "video"),
    count(p.counts.audio, "sound"),
  ].join(" · ");
const path = (p: ProjectSummaryV1, tab: string) =>
  `#/p/${encodeURIComponent(p.id)}/${tab}`;

function ProjectCard({ project }: { project: ProjectSummaryV1 }) {
  return (
    <button
      type="button"
      className="creative-project"
      data-action="open-project"
      data-id={project.id}
    >
      <span className="creative-cover">
        {project.cover ? (
          <img src={project.cover} alt="" loading="lazy" />
        ) : (
          <span className="creative-empty" aria-hidden="true">
            {project.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="creative-project-body">
        <span className="creative-project-title">{project.name}</span>
        <span className="creative-meta">{counts(project)}</span>
        <span className="creative-budget">
          {money(project.budget.spentMicro)} of{" "}
          {money(project.budget.allowanceMicro)} allocated this month
          (estimated)
        </span>
        <span className="creative-open">Open studio →</span>
      </span>
    </button>
  );
}
function Home({
  projects,
  videosConfigured,
  woodhouseShare,
  showcase,
  canEdit,
}: HomeProps) {
  const recent = projects[0];
  return (
    <div className="creative-home">
      <header className="creative-intro">
        <div>
          <h1>Make something worth keeping.</h1>
          <p>Your images, films and sound, in one place.</p>
        </div>
        {canEdit && (
          <button type="button" className="button" data-action="new-project">
            New studio
          </button>
        )}
      </header>
      {recent ? (
        <section
          className="creative-stage"
          aria-labelledby="creative-stage-title"
        >
          <div className="creative-stage-image">
            {recent.cover ? (
              <img src={recent.cover} alt="" />
            ) : (
              <span className="creative-empty" aria-hidden="true">
                {recent.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="creative-stage-copy">
            <p className="creative-stage-label">Continue in your studio</p>
            <h2 id="creative-stage-title">{recent.name}</h2>
            {recent.creativeDirection && (
              <p className="creative-direction">{recent.creativeDirection}</p>
            )}
            <p className="creative-meta">{counts(recent)}</p>
            <p className="creative-budget">
              {money(recent.budget.spentMicro)} of{" "}
              {money(recent.budget.allowanceMicro)} allocated this month
              (estimated)
            </p>
            <div className="creative-stage-actions">
              <a className="button" href={path(recent, "library")}>
                Open library
              </a>
              {canEdit && (
                <a className="button secondary" href={path(recent, "create")}>
                  Create &amp; refine
                </a>
              )}
            </div>
            {canEdit && (
              <a className="creative-assemble" href={path(recent, "assemble")}>
                Build a storyboard →
              </a>
            )}
          </div>
        </section>
      ) : (
        <section className="creative-blank">
          <h2>Start with an idea</h2>
          <p>
            Add your own images, video or sound, then create and save new work
            alongside them.
          </p>
          {canEdit && (
            <button type="button" className="button" data-action="new-project">
              Create your first studio
            </button>
          )}
        </section>
      )}
      {showcase.length > 0 && (
        <section
          className="creative-showcase"
          aria-labelledby="creative-showcase-title"
        >
          <div className="creative-section-head">
            <div>
              <h2 id="creative-showcase-title">Made in Media Studio</h2>
              <p>Published work, with the story behind each piece.</p>
            </div>
            {woodhouseShare && (
              <a href="/portfolio">Explore published work →</a>
            )}
          </div>
          <div className="creative-film-grid">
            {showcase.map((film) => (
              <article className="creative-film" key={film.slug}>
                {film.hasPoster ? (
                  <video
                    controls
                    playsInline
                    preload="none"
                    poster={`/p/${encodeURIComponent(film.slug)}/poster`}
                    aria-label={film.title}
                  >
                    <source
                      src={`/p/${encodeURIComponent(film.slug)}/media`}
                      type={film.mime}
                    />
                  </video>
                ) : (
                  <a
                    className="creative-film-empty"
                    href={`/p/${encodeURIComponent(film.slug)}`}
                  >
                    Open film<span>{film.title}</span>
                  </a>
                )}
                <h3>{film.title}</h3>
                {film.description && <p>{film.description}</p>}
                <a href={`/p/${encodeURIComponent(film.slug)}`}>
                  Watch and see the source →
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="creative-projects">
        <div className="creative-section-head">
          <h2 id="creative-projects">Your studios</h2>
          <span>{count(projects.length, "project")}</span>
        </div>
        {projects.length ? (
          <div className="creative-grid">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <p className="creative-meta">
            No studios available for this account yet.
          </p>
        )}
      </section>
      <section className="creative-footer" aria-label="Studio tools">
        <div>
          <h2>From first idea to finished piece.</h2>
          <p>
            Create or refine a still, animate it, add sound and assemble a cut.
            Each paid request shows an estimate first.
          </p>
        </div>
        <div className="creative-path-links">
          {woodhouseShare && (
            <a className="button secondary" href="/portfolio">
              Browse Share artwork
            </a>
          )}
          <a className="button secondary" href="/tools/audio-trim">
            Trim audio locally
          </a>
          <a className="button secondary" href="/tools/video-clip">
            Clip video locally
          </a>
          <a className="button secondary" href="/help">
            Explore studio tools
          </a>
        </div>
        <p className="creative-provider">
          {videosConfigured
            ? "Video generation is configured; the provider checks funding on submit."
            : "Video generation needs a fal.ai key on this studio."}{" "}
          Uploads, the library and publishing work without a model account.
        </p>
      </section>
    </div>
  );
}
let root: Root | undefined;
export function renderHome(container: HTMLElement, props: HomeProps): void {
  root ??= createRoot(container);
  flushSync(() => root!.render(<Home {...props} />));
}
export function unmountHome(): void {
  if (root) {
    root.unmount();
    root = undefined;
  }
}
export {
  renderLibrary,
  renderViewer,
  renderCreate,
  renderHistory,
  renderPublish,
  renderAssemble,
  renderSettings,
  unmountMedia,
} from "./library";

export { mountAudioTrim } from "./audio-trim";

export async function mountVideoClip(container: HTMLElement) {
  const { mountVideoClip: mount } = await import("./video-clip");
  mount(container);
}
