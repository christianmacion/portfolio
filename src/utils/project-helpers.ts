/**
 * project-helpers.ts : Typed query helper for the `project` collection.
 *
 * Centralizes the (await getCollection('project')) boilerplate so that
 * downstream `.filter(p => …)`, `.map(p => …)` callsites retain the
 * CollectionEntry<'project'> type through the callback. Without this,
 * each callback's `p` parameter is implicit-any (ts(7006)).
 *
 * Pattern: bind the result into a named, explicitly-typed variable
 * before chaining. `astro check` then infers the callback type through
 * the variable.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type ProjectEntry = CollectionEntry<'project'>;

/** Count of projects in the given role (e.g. 'quant', 'ai'). */
export async function countProjectsByRole(role: ProjectEntry['data']['role']): Promise<number> {
  const all: ProjectEntry[] = await getCollection('project');
  return all.filter((p) => p.data.role === role).length;
}
