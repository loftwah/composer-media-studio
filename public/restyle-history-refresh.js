// Keep newer in-memory job updates if a project read raced with a status poll.
export function mergeHistoryRead(project, data) {
  const current = new Map(project.generations.map(job => [job.id, job]));
  let hasNewer = false;
  const jobs = data.generations.map(job => {
    const prior = current.get(job.id); current.delete(job.id);
    if (prior && Number.isFinite(prior.updatedAt) && Number.isFinite(job.updatedAt) && prior.updatedAt > job.updatedAt) { hasNewer = true; return prior; }
    return job;
  });
  if (current.size) hasNewer = true;
  project.generations = [...jobs, ...current.values()];
  if (!hasNewer) project.budget = data.budget;
}
