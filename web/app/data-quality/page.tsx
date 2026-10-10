/**
 * data-quality — app/data-quality/page.tsx
 *
 * Two independent sources of truth are shown side by side, and labelled as such:
 *   1. data/dataset_report.json — written by the pipeline (its own definition of
 *      "core" / "extended" fields, plus cross-language linkage counts);
 *   2. live aggregates computed here from data/works.json at request time, which
 *      cover *every* schema field, not just the pipeline's chosen subset.
 *
 * The same pattern is repeated for the anime catalogue:
 *   3. data/anime_report.json   — the pipeline's own coverage numbers;
 *   4. live aggregates computed here from data/anime.json (lib/anime.ts), which
 *      are cross-checked against (3) row by row so a stale report is visible.
 */
import type { Metadata } from 'next';

import { EmptyState, SectionCard, UnknownValue } from '@/components/ui';
import {
  ANIME_FIELD_DESCRIPTORS,
  animeFieldCoverage,
  getAnime,
  getAnimeGeneratedAt,
  getAnimeLiveStats,
  getAnimeReport,
} from '@/lib/anime';
import {
  ADAPTATION_SOURCE_LABELS,
  ANIME_FORMAT_LABELS,
  ANIME_SEASON_LABELS,
  ANIME_STATUS_LABELS,
} from '@/lib/anime-labels';
import type { Anime } from '@/lib/anime-types';
import { getDatasetGeneratedAt, getDatasetReport, getLiveStats } from '@/lib/data';
import {
  CLASSIFICATION_BASIS_LABELS,
  MEDIA_TYPE_LABELS,
  SERIALIZATION_STATUS_LABELS,
  YURI_TYPE_LABELS,
} from '@/lib/labels';
import { formatTimestamp, relativeAge } from '@/lib/policy';
import { WORK_FIELD_DESCRIPTORS, fieldLabel } from '@/lib/provenance';

export const metadata: Metadata = {
  title: '資料品質',
  description: '核心欄位完整度、逐欄位溯源覆蓋率與跨語言連結狀況。',
};

function PercentBar({ ratio }: { ratio: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  const color = percent >= 80 ? '#059669' : percent >= 40 ? '#d97706' : '#dc2626';
  return (
    <span className="inline-flex items-center gap-2">
      {/* Inline width: `.confidence-bar` in globals.css loads after Tailwind and
          would override a `w-24` utility on the same element. */}
      <span
        className="inline-block overflow-hidden rounded-full bg-zinc-200 align-middle"
        style={{ width: '6rem', height: '0.35rem' }}
      >
        <span className="block h-full" style={{ width: `${percent}%`, background: color }} />
      </span>
      <span className="tabular-nums text-xs text-zinc-600">{percent}%</span>
    </span>
  );
}

function TallyList({ title, tally, labels }: { title: string; tally: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(tally ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded border border-zinc-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm">
          <UnknownValue />
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {entries.map(([key, value]) => (
            <li key={key} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate" title={key}>
                {labels?.[key] ?? key}
              </span>
              <span className="tabular-nums text-zinc-600">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DataQualityPage() {
  const report = getDatasetReport();
  const live = getLiveStats();
  const generatedAt = getDatasetGeneratedAt();

  const coreFields = Object.entries(report?.core_field_completeness ?? {});
  const extendedFields = Object.entries(report?.extended_field_completeness ?? {});
  const schemaErrors = Array.isArray(report?.schema_errors) ? report.schema_errors : [];

  const fieldsMissingValue = WORK_FIELD_DESCRIPTORS.filter((descriptor) => {
    const ratio = live.fieldCompleteness[descriptor.name] ?? 0;
    return ratio < 1;
  });

  /* ---------------------------------------------------------------- *
   * Anime catalogue coverage (data/anime_report.json + live from anime.json)
   * ---------------------------------------------------------------- */
  const animeReport = getAnimeReport();
  let animeEntries: Anime[] = [];
  let animeLive: ReturnType<typeof getAnimeLiveStats> | null = null;
  let animeGeneratedAt: string | null = null;
  let animeError: string | null = null;
  try {
    animeEntries = getAnime();
    animeLive = getAnimeLiveStats();
    animeGeneratedAt = getAnimeGeneratedAt();
  } catch (error) {
    animeError = error instanceof Error ? error.message : String(error);
  }
  const animeCoverage = animeLive ? animeFieldCoverage(animeEntries) : [];

  /** Report vs live, metric by metric. Every value comes from one of the files. */
  const animeCrossCheck =
    animeReport && animeLive
      ? ([
          ['條目總數', animeReport.total, animeLive.total],
          ['有製作公司', animeReport.with_studio, animeLive.withStudio],
          ['有主要聲優', animeReport.with_cast, animeLive.withCast],
          ['有開播時間', animeReport.with_start_date, animeLive.withStartDate],
          ['有封面', animeReport.with_cover, animeLive.withCover],
          ['已宣布未播出', animeReport.announced_not_aired, animeLive.announcedNotAired],
          ['劇場版', animeReport.movies, animeLive.movies],
          ['已連結到 Work', animeReport.linked_works, animeLive.linkedWorks],
        ] as const)
      : [];

  const mapsAgree = (a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean => {
    const left = Object.entries(a ?? {}).sort();
    const right = Object.entries(b ?? {}).sort();
    return JSON.stringify(left) === JSON.stringify(right);
  };
  const animeDistributions =
    animeReport && animeLive
      ? [
          { label: 'by_format', agree: mapsAgree(animeReport.by_format, animeLive.byFormat) },
          {
            label: 'by_adaptation_source',
            agree: mapsAgree(animeReport.by_adaptation_source, animeLive.byAdaptationSource),
          },
          { label: 'by_status', agree: mapsAgree(animeReport.by_status, animeLive.byStatus) },
          { label: 'by_year（season_year 優先）', agree: mapsAgree(animeReport.by_year, animeLive.byYear) },
        ]
      : [];

  const originalAllFormats = animeEntries.filter((entry) => entry.adaptation_source === 'original').length;
  const originalTv = animeEntries.filter(
    (entry) => entry.adaptation_source === 'original' && entry.format === 'tv',
  ).length;
  const animeFieldsMissingValue = animeCoverage.filter((row) => row.withValue < animeEntries.length);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900">資料品質</h1>
        <p className="mt-1 text-sm text-zinc-700">
          本站的誠實原則是「無法確認就標 unknown」。此頁同時呈現<strong>管線自己的完整度報告</strong>與
          <strong>Web 端即時計算的逐欄位統計</strong>，兩者定義不同，請勿混用。
        </p>
        <ul className="mt-2 space-y-1 text-xs text-zinc-600">
          <li>
            <strong>管線報告</strong>：<code className="mono">data/dataset_report.json</code>，產生於{' '}
            {report ? formatTimestamp(report.generated_at) : 'unknown'}。它只統計一組固定的
            「核心／延伸」欄位。
          </li>
          <li>
            <strong>即時統計</strong>：由本站讀取 <code className="mono">data/works.json</code>
            （匯出於 {formatTimestamp(generatedAt)}，約 {relativeAge(generatedAt) ?? 'unknown'}）後當場計算，
            覆蓋 schema 中的<strong>全部 {WORK_FIELD_DESCRIPTORS.length} 個欄位</strong>。
          </li>
        </ul>
      </section>

      {!report ? (
        <EmptyState title="找不到 dataset_report.json" tone="warn">
          <p>管線尚未產生完整度報告。以下即時統計仍可正常顯示。</p>
        </EmptyState>
      ) : null}

      {report ? (
        <SectionCard
          title="管線報告摘要"
          subtitle="來源紀錄數、作品數與跨語言連結狀況。"
        >
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">作品總數</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.works_total}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">原始紀錄檔數</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.raw_files}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">跨語言已連結</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.cross_language_linked}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">待連結</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.pending_linkage}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有繁中版書目</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.works_with_zh_tw_volumes}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">合併紀錄</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.merges?.length ?? 0}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">schema 錯誤</dt>
              <dd className="text-lg font-semibold tabular-nums">{schemaErrors.length}</dd>
            </div>
          </dl>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <TallyList title="來源紀錄" tally={report.source_records} />
            <TallyList title="依媒體類型" tally={report.by_media_type} labels={MEDIA_TYPE_LABELS} />
            <TallyList title="依連載狀態" tally={report.by_status} labels={SERIALIZATION_STATUS_LABELS} />
          </div>

          {schemaErrors.length > 0 ? (
            <div className="callout callout-warn mt-3 text-xs">
              <p className="font-semibold">管線回報的 schema 錯誤</p>
              <pre className="mono mt-1 overflow-auto">{JSON.stringify(schemaErrors, null, 2)}</pre>
            </div>
          ) : (
            <p className="mt-3 text-xs text-emerald-700">
              管線回報的 <code className="mono">schema_errors</code> 為空：本輪匯出全部通過 schema 驗證。
            </p>
          )}
        </SectionCard>
      ) : null}

      {report ? (
        <SectionCard
          title="管線定義的核心欄位完整度"
          subtitle="這 8 個欄位被管線視為「沒有它就沒意義」，目前皆為 100%。"
        >
          <div className="overflow-x-auto">
            <table className="field-table min-w-[28rem]">
              <thead>
                <tr>
                  <th>欄位</th>
                  <th>完整度</th>
                </tr>
              </thead>
              <tbody>
                {coreFields.map(([field, ratio]) => (
                  <tr key={field}>
                    <th>
                      <span className="font-medium text-zinc-800">{fieldLabel(field)}</span>
                      <span className="mono block text-xs text-zinc-500">{field}</span>
                    </th>
                    <td>
                      <PercentBar ratio={ratio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {report ? (
        <SectionCard
          title="管線定義的延伸欄位完整度"
          subtitle="這些欄位官方多半不公布或需人工核對，因此完整度偏低是預期結果，不是資料損壞。"
        >
          <div className="overflow-x-auto">
            <table className="field-table min-w-[28rem]">
              <thead>
                <tr>
                  <th>欄位</th>
                  <th>完整度</th>
                </tr>
              </thead>
              <tbody>
                {extendedFields.map(([field, ratio]) => (
                  <tr key={field}>
                    <th>
                      <span className="font-medium text-zinc-800">{fieldLabel(field)}</span>
                      <span className="mono block text-xs text-zinc-500">{field}</span>
                    </th>
                    <td>
                      <PercentBar ratio={ratio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            例：<code className="mono">chapter_count</code> 為 0%，因為 schema 禁止由「第 12 話」這類標籤推算累計話數；
            <code className="mono">start_date</code> 亦為 0%，官方通常只公布到月份。
          </p>
        </SectionCard>
      ) : null}

      <SectionCard
        title={`逐欄位完整度與溯源覆蓋率（全部 ${WORK_FIELD_DESCRIPTORS.length} 個欄位）`}
        subtitle="完整度＝有值的作品比例；溯源覆蓋率＝有 field_sources 紀錄的作品比例。兩者皆由本站即時計算。"
      >
        <div className="overflow-x-auto">
          <table className="field-table min-w-[40rem]">
            <thead>
              <tr>
                <th className="w-[16rem]">欄位</th>
                <th className="w-[12rem]">完整度（有值）</th>
                <th className="w-[12rem]">溯源覆蓋率</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {WORK_FIELD_DESCRIPTORS.map((descriptor) => {
                const completeness = live.fieldCompleteness[descriptor.name] ?? 0;
                const provenance = live.fieldsWithProvenance[descriptor.name] ?? 0;
                const provenanceRatio = live.workCount === 0 ? 0 : provenance / live.workCount;
                return (
                  <tr key={descriptor.name}>
                    <th>
                      <span className="font-medium text-zinc-800">{descriptor.label}</span>
                      <span className="mono block text-xs text-zinc-500">{descriptor.name}</span>
                    </th>
                    <td>
                      <PercentBar ratio={completeness} />
                    </td>
                    <td>
                      <PercentBar ratio={provenanceRatio} />
                    </td>
                    <td className="text-xs text-zinc-600">
                      {completeness === 0 ? (
                        <span className="badge badge-none">全部 unknown（本輪無值）</span>
                      ) : provenance === 0 ? (
                        <span className="badge badge-editorial">有值但無欄位級溯源</span>
                      ) : (
                        <span className="badge badge-plain">
                          {provenance} / {live.workCount} 筆有溯源
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {fieldsMissingValue.length > 0 ? (
          <p className="mt-3 text-xs text-zinc-600">
            目前仍有 {fieldsMissingValue.length} 個欄位未達 100%：
            {fieldsMissingValue.map((descriptor) => descriptor.name).join('、')}。
            這些欄位在作品頁一律顯示 <span className="unknown-value">unknown</span>，不會被隱藏或推測填充。
          </p>
        ) : (
          <p className="mt-3 text-xs text-emerald-700">全部欄位皆已 100% 填滿。</p>
        )}
      </SectionCard>

      <SectionCard
        title="即時統計（由本站自 works.json 計算）"
        subtitle="與上方管線報告互為交叉檢查：若兩者不一致，代表報告已過期。"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <TallyList title="依媒體類型" tally={live.byMediaType} labels={MEDIA_TYPE_LABELS} />
          <TallyList title="依連載狀態" tally={live.bySerializationStatus} labels={SERIALIZATION_STATUS_LABELS} />
          <TallyList title="依百合類型" tally={live.byYuriType} labels={YURI_TYPE_LABELS} />
          <TallyList title="依動畫狀態" tally={live.byAnimeStatus} />
          <TallyList title="依分類依據" tally={live.byClassificationBasis} labels={CLASSIFICATION_BASIS_LABELS} />
          <TallyList title="依雜誌／平台" tally={live.byMagazine} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ['作品數', live.workCount],
              ['sources[] 總筆數', live.totalWorkSources],
              ['有繁中版', live.worksWithZhTwEdition],
              ['有簡中官方版', live.worksWithZhCnEdition],
              ['有評分紀錄', live.worksWithRatings],
              ['有書評元資料', live.worksWithReviewMeta],
              ['有動畫詳情', live.worksWithAnimeDetails],
              ['已登錄來源', live.totalRegisteredSources + live.totalReviewSources],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="callout mt-4 text-xs text-zinc-700">
          <p className="font-semibold text-zinc-800">已知的資料缺口（如實揭露）</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              <code className="mono">ratings[]</code> 與 <code className="mono">review_meta[]</code> 目前
              全數為空（{live.totalRatings} / {live.totalReviewMeta} 筆）：
              評價層需由每日管線自合規來源採集，尚未回填。作品頁因此顯示「尚無站內評分」。
            </li>
            <li>
              <code className="mono">ja_volumes[]</code>、<code className="mono">zh_cn_volumes[]</code> 與
              <code className="mono">anime_details</code> 亦為空，故相關區塊以明確空狀態呈現。
            </li>
            <li>
              本輪 36 筆作品的 <code className="mono">yuri_type</code> 皆為 <code className="mono">uncertain</code>，
              <code className="mono">classification_basis</code> 皆為 <code className="mono">editorial</code>：
              百合下位分類需閱讀正文才能判定，管線刻意不猜測。
            </li>
          </ul>
        </div>
      </SectionCard>

      {/* ================================================================ *
       * 百合動畫 — pipeline report (data/anime_report.json)
       * ================================================================ */}
      <SectionCard
        title="百合動畫覆蓋率（管線報告 data/anime_report.json）"
        subtitle="這一節的數字由採集管線自行統計；下方另有一份由本站自 anime.json 即時計算的版本，兩者互相對帳。"
      >
        {animeError ? (
          <EmptyState title="無法載入 data/anime.json" tone="warn">
            <p className="mono">{animeError}</p>
          </EmptyState>
        ) : null}

        {!animeReport ? (
          <EmptyState title="找不到 data/anime_report.json" tone="warn">
            <p>管線尚未產生動畫覆蓋率報告；下方即時統計仍可正常顯示。</p>
          </EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ['動畫條目總數', animeReport.total],
                  ['本輪抓取筆數', animeReport.raw_fetched],
                  ['有製作公司', animeReport.with_studio],
                  ['有主要聲優', animeReport.with_cast],
                  ['有開播時間', animeReport.with_start_date],
                  ['有封面', animeReport.with_cover],
                  ['已宣布未播出', animeReport.announced_not_aired],
                  ['劇場版', animeReport.movies],
                  ['已連結 Work', animeReport.linked_works],
                  ['schema 錯誤', Array.isArray(animeReport.schema_errors) ? animeReport.schema_errors.length : 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded border border-zinc-200 p-2">
                  <dt className="text-xs text-zinc-500">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-2 text-xs text-zinc-600">
              報告產生於 {formatTimestamp(animeReport.generated_at)}
              ，動畫資料匯出於 {animeGeneratedAt ? formatTimestamp(animeGeneratedAt) : 'unknown'}
              。收錄範圍：<span className="text-zinc-700">{animeReport.collection_note}</span>
              {animeReport.dropped ? (
                <>
                  {' '}
                  排除筆數：
                  {Object.entries(animeReport.dropped)
                    .filter(([, value]) => typeof value === 'number')
                    .map(([key, value]) => `${key}=${value}`)
                    .join('、')}
                  。
                </>
              ) : null}
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <TallyList title="依形態" tally={animeReport.by_format} labels={ANIME_FORMAT_LABELS} />
              <TallyList
                title="依改編類型"
                tally={animeReport.by_adaptation_source}
                labels={ADAPTATION_SOURCE_LABELS}
              />
              <TallyList title="依狀態" tally={animeReport.by_status} labels={ANIME_STATUS_LABELS} />
            </div>

            <div className="mt-3 rounded border border-zinc-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                依年份（by_year，season_year 優先）
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600">
                {Object.entries(animeReport.by_year ?? {})
                  .sort((a, b) => (a[0] === 'unknown' ? 1 : b[0] === 'unknown' ? -1 : Number(b[0]) - Number(a[0])))
                  .map(([year, count]) => (
                    <span key={year} className="tabular-nums">
                      <strong className="text-zinc-800">{year}</strong> {count}
                    </span>
                  ))}
              </p>
            </div>
          </>
        )}
      </SectionCard>

      {/* ================================================================ *
       * 百合動畫 — live cross-check (data/anime.json)
       * ================================================================ */}
      <SectionCard
        title="百合動畫即時統計與對帳（由本站自 anime.json 計算）"
        subtitle="與上方管線報告逐項比對；任何一列不一致，就代表報告與匯出檔不是同一輪產物。"
      >
        {!animeLive ? (
          <EmptyState title="無法計算動畫即時統計" tone="warn">
            <p>{animeError ?? 'data/anime.json 不可用。'}</p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="field-table min-w-[30rem]">
                <thead>
                  <tr>
                    <th>指標</th>
                    <th>管線報告</th>
                    <th>即時計算</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {animeCrossCheck.map(([label, reportValue, liveValue]) => (
                    <tr key={label}>
                      <th className="font-medium text-zinc-800">{label}</th>
                      <td className="tabular-nums">{reportValue}</td>
                      <td className="tabular-nums">{liveValue}</td>
                      <td>
                        {reportValue === liveValue ? (
                          <span className="badge badge-official">一致</span>
                        ) : (
                          <span className="badge badge-editorial">不一致（報告可能過期）</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {animeDistributions.map((row) => (
                    <tr key={row.label}>
                      <th className="font-medium text-zinc-800">
                        分布 <span className="mono text-xs">{row.label}</span>
                      </th>
                      <td colSpan={2} className="text-xs text-zinc-600">
                        逐鍵比對（含值為 0 的鍵）
                      </td>
                      <td>
                        {row.agree ? (
                          <span className="badge badge-official">一致</span>
                        ) : (
                          <span className="badge badge-editorial">不一致（報告可能過期）</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <TallyList title="即時：依形態" tally={animeLive.byFormat} labels={ANIME_FORMAT_LABELS} />
              <TallyList
                title="即時：依改編類型"
                tally={animeLive.byAdaptationSource}
                labels={ADAPTATION_SOURCE_LABELS}
              />
              <TallyList title="即時：依狀態" tally={animeLive.byStatus} labels={ANIME_STATUS_LABELS} />
              <TallyList title="即時：依季" tally={animeLive.bySeason} labels={ANIME_SEASON_LABELS} />
              <TallyList title="即時：field_sources 依據" tally={animeLive.byBasis} />
              <div className="rounded border border-zinc-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">規模</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  <li className="flex justify-between gap-2">
                    <span>不重複製作公司</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.distinctStudios}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>不重複聲優</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.distinctVoiceActors}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>聲優名單筆數</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.castEntries}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>其中無聲優（unknown）</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.castEntriesWithoutVoiceActor}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>sources[] 總筆數</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.totalSources}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>field_sources 總筆數</span>
                    <span className="tabular-nums text-zinc-600">{animeLive.totalFieldSources}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>全欄位皆 third_party 的條目</span>
                    <span className="tabular-nums text-zinc-600">
                      {animeLive.fullyThirdParty} / {animeLive.total}
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="callout callout-warn mt-3 text-xs text-zinc-700">
              <p className="font-semibold text-zinc-800">動畫資料全部是第三方來源（AniList）</p>
              <p className="mt-1">
                本資料集 {animeLive.totalFieldSources} 筆 <code className="mono">field_sources</code> 的{' '}
                <code className="mono">basis</code> 只有一種值：
                {Object.keys(animeLive.byBasis).length === 1 ? (
                  <code className="mono"> {Object.keys(animeLive.byBasis)[0]}</code>
                ) : (
                  Object.keys(animeLive.byBasis).join('、')
                )}
                ，即「第三方資料庫」，來源為 AniList GraphQL API。沒有任何一個動畫欄位是
                <code className="mono">official</code>；詳見 <a href="/anime">百合動畫目錄</a>每筆頁面的溯源區塊。
              </p>
              <p className="mt-1">
                另外，<code className="mono">field_confidence</code> 內有{' '}
                <code className="mono">studio / broadcast / cast</code> 這類<strong>不是 schema 欄位名</strong>的鍵。
                本站不代為對應到 <code className="mono">studios / start_date / main_cast</code>，只在詳細頁照原文列出。
              </p>
            </div>

            <p className="mt-3 text-xs text-zinc-600">
              分類口徑提醒：<code className="mono">original</code>（原創）共 {originalAllFormats} 部，
              其中 <code className="mono">format = tv</code> 的「原創 TV 動畫」為 {originalTv} 部，
              其餘 {Math.max(0, originalAllFormats - originalTv)} 部是 OVA／ONA／劇場版等形態——
              目錄頁的「原創 TV 動畫」預設只計算 TV，不混入其他形態。
            </p>
          </>
        )}
      </SectionCard>

      {/* ================================================================ *
       * 百合動畫 — per-field completeness + provenance coverage
       * ================================================================ */}
      <SectionCard
        title={`百合動畫逐欄位完整度與溯源覆蓋率（全部 ${ANIME_FIELD_DESCRIPTORS.length} 個 schema 欄位）`}
        subtitle="完整度＝有值的條目比例；溯源覆蓋率＝field_sources 有該欄位紀錄的比例。兩者皆由本站即時計算。"
      >
        {!animeLive ? (
          <EmptyState title="無法計算" tone="warn">
            <p>data/anime.json 不可用。</p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="field-table min-w-[40rem]">
                <thead>
                  <tr>
                    <th className="w-[16rem]">欄位</th>
                    <th className="w-[12rem]">完整度（有值）</th>
                    <th className="w-[12rem]">溯源覆蓋率</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {animeCoverage.map((row) => (
                    <tr key={row.field}>
                      <th>
                        <span className="font-medium text-zinc-800">{row.label}</span>
                        <span className="mono block text-xs text-zinc-500">{row.field}</span>
                      </th>
                      <td>
                        <PercentBar ratio={row.completeness} />
                      </td>
                      <td>
                        <PercentBar ratio={row.provenanceRatio} />
                      </td>
                      <td className="text-xs text-zinc-600">
                        {row.withValue === 0 ? (
                          <span className="badge badge-none">全部 unknown（本輪無值）</span>
                        ) : row.withProvenance === 0 ? (
                          <span className="badge badge-editorial">有值但無欄位級溯源</span>
                        ) : (
                          <span className="badge badge-plain">
                            {row.withValue} / {animeLive.total} 筆有值
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-zinc-600">
              目前有 {animeFieldsMissingValue.length} / {animeCoverage.length} 個欄位未達 100%
              {animeFieldsMissingValue.length > 0 ? (
                <>
                  （{animeFieldsMissingValue.map((row) => row.field).join('、')}）
                </>
              ) : null}
              。這些欄位在動畫頁一律顯示 <span className="unknown-value">unknown</span> 或「未收錄」，
              不會被隱藏或推測填充。特別注意 <code className="mono">title_zh_tw</code>／
              <code className="mono">title_zh_cn</code>：本資料集 100% 為 null，原因是來源（AniList）不提供官方中文譯名，
              本站仍會渲染這兩個欄位並標明「未收錄」。
            </p>
          </>
        )}
      </SectionCard>
    </div>
  );
}
