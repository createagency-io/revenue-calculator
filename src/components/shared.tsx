import { clientDisplayName } from '../lib/calc';
import { go, type Route } from '../lib/router';
import { useStore } from '../lib/store';
import type { Project } from '../lib/types';
import { duplicateProject } from '../lib/factory';

/** Copy a project as a new quotation with fresh document numbers from the database. */
export function useDuplicate() {
  const { upsertProject, takeNumber, toast } = useStore();
  return async (p: Project): Promise<Project | null> => {
    try {
      const c = duplicateProject(p);
      c.quoteNumber = await takeNumber('quote');
      c.invoiceNumber = await takeNumber('invoice');
      upsertProject(c);
      toast(`Duplicated as ${c.quoteNumber}`);
      return c;
    } catch (e) {
      toast(`Could not duplicate: ${(e as Error).message}`, 'err');
      return null;
    }
  };
}

/** Selected project for views that work on one project at a time (?p=id in the URL). */
export function usePicked(route: Route): Project | null {
  const { data } = useStore();
  const id = route.query.get('p');
  return data.projects.find((p) => p.id === id) ?? data.projects[0] ?? null;
}

export function ProjectPicker({ view, value }: { view: string; value: Project | null }) {
  const { data } = useStore();
  return (
    <select className="input max-w-full sm:w-96" value={value?.id ?? ''} onChange={(e) => go(`${view}?p=${e.target.value}`)} aria-label="Choose project">
      {data.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {(p.quoteNumber || 'Draft') + ' — ' + clientDisplayName(p) + ' — ' + p.title}
        </option>
      ))}
    </select>
  );
}
