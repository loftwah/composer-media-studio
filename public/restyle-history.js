// Merge the response from the same-project restyle submit without touching drafts.
export function mergeRestyleResponse(project, projectId, result) {
  const generation = result?.generation;
  if (!project || project.id !== projectId || !generation || typeof generation.id !== 'string') return false;
  const index = project.generations.findIndex(item => item.id === generation.id);
  if (index >= 0) {
    const current = project.generations[index];
    if (Number.isFinite(current.updatedAt) && Number.isFinite(generation.updatedAt) && current.updatedAt > generation.updatedAt) return false;
    project.generations[index] = generation;
  } else project.generations.unshift(generation);
  return true;
}
