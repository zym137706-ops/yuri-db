/**
 * Rating display — implements docs/phase1-feasibility-report.md §5.2 exactly.
 *
 * P1  there is no review-body column; we render aggregate numbers + an outbound link.
 * P2  score_scale is always shown explicitly (5 / 10 / 100).
 * P3  scores of different scales are grouped, never averaged together.
 * P4  display_allowed === false ⇒ link only, no number anywhere.
 * P5  every value carries source_url + retrieved_at.
 */
import { EmptyState, Pill, SafeLink } from './ui';
import {
  CROSS_SCALE_AVERAGE_IS_FORBIDDEN,
  formatRatingDisplay,
  groupRatingsByScale,
  ungroupedRatings,
} from '@/lib/policy';
import type { RatingLike } from '@/lib/policy';
import type { Rating } from '@/lib/types';

// `RatingLike` (not `Rating`) because groupRatingsByScale() returns the loose
// view type — the strict `Rating` is only the component's public prop type.
function RatingRow({ rating }: { rating: RatingLike }) {
  const view = formatRatingDisplay(rating);

  return (
    <li className="rounded border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-zinc-700">{rating.source_id}</span>
        <Pill tone="plain" title="rating.region">
          {view.regionText}
        </Pill>
        <Pill tone="accent" title="rating.score_scale（分數口徑必須顯式標示）">
          口徑 {view.scaleText}
        </Pill>
        {rating.display_allowed ? (
          <Pill tone="official" title="rating.display_allowed = true">
            允許展示數值
          </Pill>
        ) : (
          <Pill tone="editorial" title="rating.display_allowed = false ⇒ 僅外鏈（P4）">
            僅外鏈，不顯示數值
          </Pill>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        {view.showNumber ? (
          <>
            <span className="text-2xl font-semibold tabular-nums text-zinc-900">{view.scoreText}</span>
            {view.countText ? <span className="text-sm text-zinc-600">{view.countText}</span> : (
              <span className="unknown-value">評分件數 unknown</span>
            )}
          </>
        ) : (
          <span className="text-sm text-zinc-600">本站不顯示此來源的數值。</span>
        )}
      </div>

      {view.percent !== null ? (
        // Inline styles on purpose: `.confidence-bar` in globals.css is loaded after
        // Tailwind, so it would win over a `w-full` utility on the same element.
        <div
          className="mt-2 max-w-xs overflow-hidden rounded-full bg-zinc-200"
          style={{ height: '0.5rem' }}
          role="img"
          aria-label={`${view.scoreText}（${view.scaleText}）`}
        >
          <span className="block h-full" style={{ width: `${view.percent}%`, background: '#b8447a' }} />
        </div>
      ) : null}

      <p className="mt-2 text-xs text-zinc-600">{view.policyNote}</p>
      {view.licenseNote ? <p className="text-xs text-zinc-600">授權備註：{view.licenseNote}</p> : null}
      <p className="mt-1 text-xs">
        <SafeLink href={view.outboundUrl}>{view.outboundLabel}</SafeLink>
        <span className="ml-2 text-zinc-500">取得時間：{view.retrievedAt ?? 'unknown'}</span>
      </p>
    </li>
  );
}

export function RatingPanel({ ratings }: { ratings: Rating[] }) {
  const groups = groupRatingsByScale(ratings);
  const others = ungroupedRatings(ratings);

  return (
    <div className="space-y-4">
      <div className="callout callout-info text-xs text-zinc-700">
        <p className="font-semibold text-zinc-800">評分顯示規範（可行性報告 §5.2）</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>P1：資料庫沒有評論正文欄位，本站只顯示聚合分數與件數，並外連原站。</li>
          <li>P2：一律顯式標示分數口徑（5 分制 / 10 分制 / 100 分制）。</li>
          <li>P3：{CROSS_SCALE_AVERAGE_IS_FORBIDDEN}</li>
          <li>P4：來源條款或 robots 禁止時，只提供外鏈、不顯示數值。</li>
          <li>P5：每筆評分都附 source_url 與 retrieved_at。</li>
        </ul>
      </div>

      {ratings.length === 0 ? (
        <EmptyState title="尚無站內評分">
          此作品目前在資料庫中沒有任何已登錄的評分來源。
          依 §5.2，本站不自建評分、也不轉載評論正文；日文與繁中評分需由每日管線自合規來源採集後才會出現。
          {/*
            简体句子按需求原文保留（Phase 4 規格指定用語），說明簡中側的既定政策。
          */}
          <p className="mt-2">
            簡中側：豆瓣等來源明文禁爬，因此簡中評分位固定顯示「暫無站內評分」並改以官方條目外鏈呈現。
          </p>
        </EmptyState>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.scale}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                口徑：{group.scaleText}（{group.items.length} 筆；其中 {group.displayableCount} 筆允許顯示數值）
              </h3>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {group.items.map((rating) => (
                  <RatingRow key={`${rating.source_id}-${rating.region}-${rating.score_scale}`} rating={rating} />
                ))}
              </ul>
              <p className="mt-1 text-xs text-zinc-500">
                此區僅彙整 {group.scaleText} 的來源；與其他口徑不合併計算。
              </p>
            </div>
          ))}

          {others.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-amber-700">
                口徑未登錄（{others.length} 筆）— 不與任何口徑合併
              </h3>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {others.map((rating) => (
                  <RatingRow key={`${rating.source_id}-${rating.region}-unknown`} rating={rating} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
