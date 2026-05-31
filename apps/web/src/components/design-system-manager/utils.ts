/**
 * Looks up the design system pinned to a project so callers can hand it to
 * `DesignSystemManagerView` / `DesignSystemModal`. Returns `null` when the
 * project is missing or has no DS attached, which the manager view treats as
 * the empty-state entry point (attach / import / pick from library).
 */
export function designSystemIdForProject(
  projectId: string,
  projects: ReadonlyArray<{ id: string; designSystemId?: string | null }>,
): string | null {
  const project = projects.find((p) => p.id === projectId);
  return project?.designSystemId ?? null;
}
