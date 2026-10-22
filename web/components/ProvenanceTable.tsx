/**
 * Provenance-first rendering of a Work record.
 *
 * Every row shows: the field name (from lib/schema-fields.json), the value
 * (or the literal "unknown"), its `field_sources` basis, its `field_confidence`,
 * and the source link + note.
 *
 * Rule enforced here: when `basis === "editorial"` the row shows the distinct
 * 編輯判斷 / editorial badge and **no source link at all**, even if the record
 * happens to carry a URL (the schema allows `source_url` to be "" for editorial).
 */
import { AuthorLinks } from './AuthorLinks';
import { BasisBadge, ConfidenceBar, Pill, UnknownValue } from './ui';
import { formatTimestamp } from '@/lib/policy';
import type { FieldView } from '@/lib/types';

/**
 * Creator fields (`authors` / `illustrators`) are the only array fields whose
 * individual values are clickable: each name links to `/?author=<name>` so a
 * reader can jump from one work to every work by the same person. Everything
 * else keeps the generic "value or unknown" rendering — including the exact
 * joined-string form, which is still used for other string-array fields.
 */
function ValueCell({ view }: { view: FieldView }) {
  if (view.isUnknown) return <UnknownValue />;

  if ((view.field === 'authors' || view.field === 'illustrators') && Array.isArray(view.raw)) {
    return <AuthorLinks names={view.raw.map((name) => String(name))} />;
  }

  if (view.token && view.token !== view.value) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="font-medium">{view.value}</span>
        <Pill tone="plain" title="原始 token">
          {view.token}
        </Pill>
      </span>
    );
  }

  return <span className="break-words">{view.value}</span>;
}

function SourceCell({ view }: { view: FieldView }) {
  const source = view.source;

  if (!source) {
    return (
      <div className="provenance-cell">
        <span className="badge badge-none">無 field_sources 紀錄</span>
        {view.isUnknown ? (
          <span className="provenance-note">值為 unknown；來源未提供。</span>
        ) : (
          <span className="provenance-note">此欄位有值，但資料集中沒有對應的溯源條目。</span>
        )}
      </div>
    );
  }

  if (view.editorial) {
    // Editorial: no link, by design (the value has no external source document).
    return (
      <div className="provenance-cell">
        <BasisBadge basis="editorial" />
        <span className="provenance-note">編輯判斷，無來源連結。</span>
        {source.note ? <span className="provenance-note">理由：{source.note}</span> : null}
      </div>
    );
  }

  return (
    <div className="provenance-cell">
      <BasisBadge basis={view.basis} />
      {view.linkableSourceUrl ? (
        <a href={view.linkableSourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mono">
          {view.linkableSourceUrl}
        </a>
      ) : (
        <UnknownValue label="source_url 未提供" />
      )}
      <span className="provenance-note">
        取得時間：
        {source.retrieved_at ? formatTimestamp(source.retrieved_at) : 'unknown'}
      </span>
      {source.note ? <span className="provenance-note">備註：{source.note}</span> : null}
    </div>
  );
}

export function ProvenanceTable({ views }: { views: FieldView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="field-table min-w-[46rem]">
        <thead>
          <tr>
            <th className="w-[13rem]">欄位</th>
            <th className="w-[20rem]">值</th>
            <th className="w-[9rem]">依據 / 把握度</th>
            <th>來源與備註</th>
          </tr>
        </thead>
        <tbody>
          {views.map((view) => (
            <tr key={view.field} id={`field-${view.field}`}>
              <td>
                <div className="font-medium text-zinc-800">{view.label}</div>
                <div className="mono text-zinc-500">{view.field}</div>
              </td>
              <td>
                <ValueCell view={view} />
              </td>
              <td>
                <div className="flex flex-col gap-1">
                  {view.basis ? <BasisBadge basis={view.basis} /> : <span className="badge badge-none">無依據</span>}
                  <ConfidenceBar confidence={view.confidence} />
                </div>
              </td>
              <td>
                <SourceCell view={view} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The per-field matrix used above the tables: one line per field, scannable. */
export function ProvenanceLegend({ editorialCount, officialCount }: { editorialCount: number; officialCount: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
      <span className="text-zinc-500">溯源圖例：</span>
      <BasisBadge basis="official" />
      <BasisBadge basis="official_tag" />
      <BasisBadge basis="editorial" />
      <BasisBadge basis="derived" />
      <span className="text-zinc-500">
        （本頁 {officialCount} 個官方欄位、{editorialCount} 個編輯判斷欄位）
      </span>
    </div>
  );
}
