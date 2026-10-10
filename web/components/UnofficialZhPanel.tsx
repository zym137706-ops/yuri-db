/**
 * unofficial_zh — schema rule D1.
 *
 * D1 requirements implemented here:
 *   - the object has no link/obtaining field at all, and this component has no
 *     code path that can emit one;
 *   - status is always rendered;
 *   - when status is "unknown" the fixed sentence required by the spec is shown
 *     verbatim;
 *   - as defence in depth, if a human `note` ever contained something that looks
 *     like a URL/domain, it is redacted instead of displayed.
 */
import { EmptyState, Pill, UnknownValue } from './ui';
import {
  UNOFFICIAL_ZH_POLICY_NOTE,
  UNOFFICIAL_ZH_UNKNOWN_SENTENCE,
  containsLinkLikeText,
  formatUnofficialZh,
} from '@/lib/policy';
import type { UnofficialZh } from '@/lib/types';

export function UnofficialZhPanel({ unofficial }: { unofficial: UnofficialZh | null | undefined }) {
  const view = formatUnofficialZh(unofficial);
  const noteIsLinkLike = view.humanNote ? containsLinkLikeText(view.humanNote) : false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-800">標註狀態：</span>
        {view.status === 'manually_flagged' ? (
          <Pill tone="editorial" title="unofficial_zh.status = manually_flagged（僅人工登記）">
            {view.statusText}（manually_flagged）
          </Pill>
        ) : (
          <Pill tone="plain" title="unofficial_zh.status = unknown（預設值）">
            {view.statusText}（unknown）
          </Pill>
        )}
        <Pill tone="none" title="此區塊在資料結構上不存在連結欄位">
          無連結欄位（D1）
        </Pill>
      </div>

      {view.status === 'unknown' ? (
        <div className="callout callout-warn">
          {/* 規格指定的固定說明句，逐字照用。 */}
          <p className="font-medium text-amber-900">{UNOFFICIAL_ZH_UNKNOWN_SENTENCE}</p>
        </div>
      ) : (
        <div className="callout callout-editorial">
          <p className="text-amber-900">{view.explanation}</p>
        </div>
      )}

      {view.status === 'manually_flagged' ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">最新話</dt>
            <dd>{view.latestChapter ?? <UnknownValue />}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">最後確認日</dt>
            <dd>{view.lastSeen ?? <UnknownValue />}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">登記人</dt>
            <dd>{view.recordedBy ?? <UnknownValue />}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">登記時間</dt>
            <dd>{view.recordedAt ?? <UnknownValue />}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">人工備註</dt>
            <dd>
              {view.humanNote === null ? (
                <UnknownValue />
              ) : noteIsLinkLike ? (
                <span className="badge badge-editorial">
                  備註疑似含連結，依 D1 已遮蔽（原始內容不顯示）
                </span>
              ) : (
                view.humanNote
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      <EmptyState title="為什麼沒有外連？">
        <p>{UNOFFICIAL_ZH_POLICY_NOTE}</p>
        <p className="mt-1">
          本項目<strong>不顯示</strong>任何漢化組名稱、網址或取得方式；畫面上也不會出現指向該類內容的連結。
        </p>
      </EmptyState>
    </div>
  );
}
