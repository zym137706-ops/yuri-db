/**
 * The three titles every record must keep: Japanese original, Traditional
 * Chinese, Simplified Chinese.
 *
 * Design point: all three are ALWAYS rendered, including when a translation is
 * missing. For Work, `null` plus `title_zh_*_status` distinguishes three genuinely
 * different situations that would otherwise look identical:
 *   - official    : an official translation exists (and is shown)
 *   - none_known  : we have verified there is currently no official edition
 *   - unchecked   : we have not checked yet
 * Collapsing these into "—" would let a reader mistake "not checked" for
 * "does not exist", which is exactly the kind of silent implication this
 * project is built to avoid.
 *
 * The component is shared with the anime catalogue (anime.json), whose schema has
 * no `title_zh_*_status` field: there, both translations are null on every entry
 * because the source (AniList) does not carry official Chinese titles. Callers in
 * that position pass `missingLabel` so the reader is told *why* the field is empty
 * instead of being shown a status token that would imply nobody ever looked.
 */
import { titleStatusLabel } from '@/lib/labels';

/** The subset of a record this component needs. `Work` and `Anime` both satisfy it. */
export interface TitleSubject {
  title_ja: string;
  title_zh_tw: string | null;
  title_zh_cn: string | null;
  /** Work carries these; the anime schema does not (they stay undefined). */
  title_zh_tw_status?: string | null;
  title_zh_cn_status?: string | null;
}

type Lang = 'ja' | 'zh_tw' | 'zh_cn';

const HEADINGS: Record<Lang, string> = {
  ja: '日文原名',
  zh_tw: '繁體中文譯名',
  zh_cn: '簡體中文譯名',
};

export function TitleTriple({
  work,
  compact = false,
  missingLabel,
}: {
  work: TitleSubject;
  compact?: boolean;
  /**
   * Shown for a missing zh translation when the record carries no
   * `title_zh_*_status` at all (i.e. the source simply has no such field).
   * Omitted ⇒ the Work wording ("尚未查證") is used.
   */
  missingLabel?: string;
}) {
  const rows: { lang: Lang; value: string | null; status: string | null }[] = [
    { lang: 'ja', value: work.title_ja, status: null },
    { lang: 'zh_tw', value: work.title_zh_tw, status: work.title_zh_tw_status ?? null },
    { lang: 'zh_cn', value: work.title_zh_cn, status: work.title_zh_cn_status ?? null },
  ];

  const missingText = (status: string | null): string => {
    if (status === 'none_known') return '目前無官方版本';
    if (status === 'unchecked') return '尚未查證';
    return missingLabel ?? (status ? titleStatusLabel(status) : '尚未查證');
  };

  if (compact) {
    return (
      <dl className="space-y-0.5 text-sm">
        {rows.map(({ lang, value, status }) => (
          <div key={lang} className="flex gap-1.5">
            <dt className="w-[74px] shrink-0 text-xs text-zinc-500">{HEADINGS[lang]}：</dt>
            <dd className={value ? 'text-zinc-800' : 'text-zinc-400'}>
              {value ?? <span>{missingText(status)}</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {rows.map(({ lang, value, status }) => (
        <div
          key={lang}
          className={`rounded border p-2 ${
            value ? 'border-zinc-200 bg-white' : 'border-dashed border-zinc-300 bg-zinc-50'
          }`}
        >
          <div className="text-[11px] font-medium text-zinc-500">{HEADINGS[lang]}</div>
          <div className={`mt-0.5 text-sm ${value ? 'text-zinc-900' : 'text-zinc-400'}`}>
            {value ?? '（未收錄）'}
          </div>
          <div className="mt-1">
            {lang === 'ja' ? (
              <span className="text-[10px] text-zinc-500">本站主鍵欄位，必填</span>
            ) : (
              <span
                className={`rounded px-1 text-[10px] ${
                  status === 'official' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                }`}
                title="title_zh_tw_status / title_zh_cn_status"
              >
                {missingLabel && !value ? missingLabel : titleStatusLabel(status)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
