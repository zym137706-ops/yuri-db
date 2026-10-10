/**
 * Volume lists (ja_volumes / zh_tw_volumes / zh_cn_volumes).
 *
 * Columns come from lib/schema-fields.json, so the table cannot drift from the
 * schema: ja_volumes carries price + cover_url, the zh lists carry translator.
 * An empty list renders an explicit empty state rather than nothing.
 */
import { EmptyState, SafeLink, UnknownValue } from './ui';
import { nestedRows } from '@/lib/provenance';
import type { VolumeJa, VolumeZh } from '@/lib/types';

type Volume = VolumeJa | VolumeZh;

export function VolumeTable({
  volumes,
  nestedKey,
  title,
}: {
  volumes: Volume[];
  nestedKey: 'ja_volumes' | 'zh_tw_volumes' | 'zh_cn_volumes';
  title: string;
}) {
  if (!volumes || volumes.length === 0) {
    return <EmptyState title={`${title}：無資料`}>此作品在資料集中沒有登錄任何一冊書目。</EmptyState>;
  }

  // Column descriptors are identical for every row, so use the first row's shape.
  const columns = nestedRows(nestedKey, volumes[0] as unknown as Record<string, unknown>, { links: false });

  return (
    <div className="overflow-x-auto">
      <table className="field-table min-w-[36rem]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.name}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {volumes.map((volume) => {
            const rows = nestedRows(nestedKey, volume as unknown as Record<string, unknown>);
            return (
              <tr key={`${nestedKey}-${volume.volume}`}>
                {rows.map((row) => (
                  <td key={row.name}>
                    {row.isUnknown ? (
                      <UnknownValue />
                    ) : row.name === 'source_url' || row.name === 'cover_url' ? (
                      <SafeLink href={row.value} className="mono" />
                    ) : (
                      row.value
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
