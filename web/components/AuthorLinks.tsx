/**
 * Author / illustrator names rendered as links to the filtered browse page.
 *
 * The target is `/?author=<encoded name>`, which `components/WorksBrowser.tsx`
 * reads back through `parseFilters` and turns into an exact-match creator
 * filter (authors OR illustrators).
 *
 * `next/link` is mandatory here: the site is exported with `trailingSlash` and
 * may be deployed under `NEXT_BASE_PATH` (GitHub Pages project site `/yuri-db/`).
 * Link prepends the base path to a `/?…` href; a hand-written
 * `<a href="/?author=…">` would silently leave it out in production.
 *
 * An empty list renders the shared "unknown" marker, so a work with no recorded
 * creator never looks like a work whose creator name is an empty link.
 */
import Link from 'next/link';

import { authorFilterHref } from '@/lib/policy';
import { UnknownValue } from './ui';

export function AuthorLinks({
  names,
  linkClassName,
}: {
  names: readonly string[];
  linkClassName?: string;
}) {
  if (names.length === 0) return <UnknownValue />;

  return (
    <>
      {names.map((name, index) => (
        <span key={`${name}-${index}`}>
          {index > 0 ? '、' : null}
          <Link
            href={authorFilterHref(name)}
            className={linkClassName}
            title={`查看 ${name} 的所有作品`}
          >
            {name}
          </Link>
        </span>
      ))}
    </>
  );
}
