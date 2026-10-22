/**
 * Work detail page — app/works/[slug]/page.tsx
 *
 * Requirement: render EVERY field defined by schemas/work.schema.json, each with
 * its `field_sources` provenance and its `field_confidence` value.
 *
 * The field inventory is driven by lib/schema-fields.json (asserted to be a
 * bijection with the schema's `properties` by scripts/assert-data-contract.mjs),
 * so a field cannot silently disappear from this page. A raw-record disclosure at
 * the bottom lets a reader verify that nothing was hidden.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { AuthorLinks } from '@/components/AuthorLinks';
import { CoverImage } from '@/components/CoverImage';
import { ProvenanceLegend, ProvenanceTable } from '@/components/ProvenanceTable';
import { RatingPanel } from '@/components/RatingPanel';
import { ReviewMetaList } from '@/components/ReviewMetaList';
import { SourceList } from '@/components/SourceList';
import { TitleTriple } from '@/components/TitleTriple';
import { UnofficialZhPanel } from '@/components/UnofficialZhPanel';
import { VolumeTable } from '@/components/VolumeTable';
import { BasisBadge, ConfidenceBar, EmptyState, Pill, SectionCard, UnknownValue } from '@/components/ui';
import { getWorkBySlug, getWorkSlugs, getWorks } from '@/lib/data';
import {
  animeStatusLabel,
  classificationBasisLabel,
  mediaTypeLabel,
  officialZhCnKindLabel,
  serializationStatusLabel,
  yuriTypeLabel,
} from '@/lib/labels';
import {
  authorFilterHref,
  confidencePercent,
  formatTimestamp,
  isBlank,
  matchesCreator,
  workHasZhCnEdition,
  workHasZhTwEdition,
} from '@/lib/policy';
import { buildFieldViews, fieldViewsByGroup, nestedRows, summarizeProvenance } from '@/lib/provenance';
import type { Work } from '@/lib/types';

type Params = { slug: string };

/** Pre-render one page per work at build time (36 pages). */
export function generateStaticParams(): Params[] {
  return getWorkSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const work = getWorkBySlug(slug);
  if (!work) return { title: '找不到作品' };
  return {
    title: `${work.title_ja}（${work.slug}）`,
    description: `${work.title_ja} 的連載、出版與中文版資訊，附逐欄位來源與把握度。`,
  };
}

function NestedTable({
  rows,
}: {
  rows: { name: string; label: string; value: string; isUnknown: boolean; href: string | null }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="field-table min-w-[30rem]">
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th className="w-[12rem]">
                <span className="font-medium text-zinc-800">{row.label}</span>
                <span className="mono block text-zinc-500">{row.name}</span>
              </th>
              <td>
                {row.isUnknown ? (
                  <UnknownValue />
                ) : row.href ? (
                  <a href={row.href} target="_blank" rel="noopener noreferrer nofollow" className="mono">
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TitleRow({ work }: { work: Work }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <CoverImage work={work} size="detail" />

        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">{work.title_ja}</h1>

          <div className="flex flex-wrap gap-1.5">
            <Pill tone="plain">{mediaTypeLabel(work.media_type)}</Pill>
            <Pill tone="plain">{serializationStatusLabel(work.serialization_status)}</Pill>
            <Pill tone="plain">{animeStatusLabel(work.anime_status)}</Pill>
            <Pill tone="plain" title={`yuri_type = ${work.yuri_type}`}>
              百合：{yuriTypeLabel(work.yuri_type)}
            </Pill>
            <Pill
              tone={work.classification_basis === 'official_tag' ? 'official' : 'editorial'}
              title={`classification_basis = ${work.classification_basis}`}
            >
              分類依據：{classificationBasisLabel(work.classification_basis)}
            </Pill>
            {workHasZhTwEdition(work) ? <Pill tone="accent">有繁中版</Pill> : null}
            {workHasZhCnEdition(work) ? <Pill tone="accent">有簡中官方版</Pill> : null}
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-zinc-500">英文標題：</dt>
              <dd>{isBlank(work.title_en) ? <UnknownValue /> : work.title_en}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Slug：</dt>
              <dd className="mono">{work.slug}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">作者：</dt>
              <dd className="min-w-0">
                <AuthorLinks names={work.authors} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">繪者：</dt>
              <dd className="min-w-0">
                <AuthorLinks names={work.illustrators} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div>
        <h2 className="mb-1.5 text-xs font-semibold text-zinc-500">
          三語標題（每部作品一律保留日文原名與繁中／簡中譯名）
        </h2>
        <TitleTriple work={work} />
      </div>
    </div>
  );
}

/**
 * "Other works by the same author/illustrator", computed at build time from the
 * FULL records (not the slim projection), because this page already has them.
 *
 * Matching is EXACT equality against `authors` ∪ `illustrators` through the same
 * `matchesCreator` used by the list filter, so the links on this page and the
 * resulting `/?author=…` view can never disagree about what counts as "by".
 */
function RelatedWorks({ work }: { work: Work }) {
  const creators = Array.from(new Set([...work.authors, ...work.illustrators]));
  if (creators.length === 0) return null;

  const related = getWorks()
    .filter((other) => other.slug !== work.slug && creators.some((name) => matchesCreator(other, name)))
    .map((other) => ({
      work: other,
      shared: creators.filter((name) => matchesCreator(other, name)),
    }));

  return (
    <SectionCard
      id="related-works"
      title="同一作者／繪者的其他作品"
      subtitle="以完整記錄在建置期精確比對 authors 與 illustrators；不做子字串比對。"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">查看全部作品：</span>
          {creators.map((name) => (
            <Link
              key={name}
              href={authorFilterHref(name)}
              className="badge badge-accent no-underline hover:underline"
            >
              {name}
            </Link>
          ))}
        </div>

        {related.length === 0 ? (
          <p className="text-sm text-zinc-600">
            本資料庫目前沒有其他作品由 {creators.join('、')} 擔任作者或繪者。
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {related.map(({ work: other, shared }) => (
              <li
                key={other.slug}
                className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between"
              >
                <Link href={`/works/${other.slug}`} className="no-underline hover:underline">
                  {other.title_ja}
                </Link>
                <span className="text-xs text-zinc-500">
                  共同：<AuthorLinks names={shared} linkClassName="no-underline hover:underline" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

export default async function WorkDetailPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const work = getWorkBySlug(slug);

  if (!work) notFound();

  const groups = fieldViewsByGroup(work);
  const allViews = buildFieldViews(work);
  const summary = summarizeProvenance(allViews);
  const editorialBasis = work.classification_basis === 'editorial';
  const confidenceKeys = Object.keys(work.field_confidence ?? {});
  const fieldSourceKeys = Object.keys(work.field_sources ?? {});

  /** field_confidence keys, including any that no Work field descriptor covers. */
  const extraConfidenceRows = confidenceKeys
    .filter((key) => !allViews.some((view) => view.field === key))
    .map((key) => ({ key, value: work.field_confidence[key] }));

  /** field_sources keys with no matching Work field (future-proofing). */
  const extraSourceRows = fieldSourceKeys
    .filter((key) => !allViews.some((view) => view.field === key))
    .map((key) => ({ key, source: work.field_sources[key] }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/" className="text-sm text-zinc-600 no-underline hover:text-zinc-900">
          ← 回搜尋結果
        </Link>
        <span className="text-xs text-zinc-500">
          最後查核：{formatTimestamp(work.last_checked)} · ID <code className="mono">{work.id}</code>
        </span>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <TitleRow work={work} />
      </section>

      <RelatedWorks work={work} />

      {/* ---------------------------------------------------------------- *
       * Provenance overview
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="provenance-summary"
        title="溯源總覽"
        subtitle="本頁所有欄位依 field_sources 標示依據；null／空值一律顯示 unknown。"
      >
        <div className="space-y-3">
          <ProvenanceLegend editorialCount={summary.editorial} officialCount={summary.official} />

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">欄位總數</dt>
              <dd className="text-lg font-semibold">{summary.total}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有值的欄位</dt>
              <dd className="text-lg font-semibold">{summary.total - summary.unknown}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">unknown</dt>
              <dd className="text-lg font-semibold">{summary.unknown}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有溯源紀錄</dt>
              <dd className="text-lg font-semibold">{summary.sourced}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有值但無溯源</dt>
              <dd className="text-lg font-semibold">{summary.unsourced}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">編輯判斷欄位</dt>
              <dd className="text-lg font-semibold">{summary.editorial}</dd>
            </div>
          </dl>

          {editorialBasis ? (
            <div className="callout callout-editorial text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <BasisBadge basis="editorial" />
                <span>
                  本筆紀錄的 <code className="mono">classification_basis</code> 為{' '}
                  <strong>{classificationBasisLabel(work.classification_basis)}</strong>
                  （{work.classification_basis}）。也就是說百合歸類來自編輯判斷，而非平台官方標籤；
                  依 schema 的 D2 規範，這類欄位<strong>不強制</strong>提供 source_url，本頁也不為其產生來源連結。
                </span>
              </p>
            </div>
          ) : (
            <div className="callout callout-info text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <BasisBadge basis="official_tag" />
                <span>
                  <code className="mono">classification_basis</code> = {work.classification_basis}
                  ：genres／yuri_type 至少一項必須帶非空 source_url（schema D2）。
                </span>
              </p>
            </div>
          )}

          <p className="text-xs text-zinc-600">
            欄位級把握度平均值：
            {summary.averageConfidence === null ? (
              <UnknownValue />
            ) : (
              <>
                <strong>{confidencePercent(summary.averageConfidence)}%</strong>
                （{summary.withConfidence} / {summary.total} 個欄位有 field_confidence 值）
              </>
            )}
            。平均把握度只是概觀，個別欄位請見下表。
          </p>
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Every schema field, grouped
       * ---------------------------------------------------------------- */}
      {groups.map((group) => (
        <SectionCard
          key={group.id}
          id={`group-${group.id}`}
          title={group.label}
          subtitle={`${group.fields.length} 個欄位；含逐欄位依據、把握度與來源。`}
        >
          <ProvenanceTable views={group.fields} />
        </SectionCard>
      ))}

      {/* ---------------------------------------------------------------- *
       * Nested objects rendered in full
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="anime-details"
        title="動畫詳情（anime_details）"
        subtitle="anime_details 是 schema 中的巢狀物件：欄位全部列出，未提供者顯示 unknown。"
      >
        {work.anime_details === null ? (
          <EmptyState title="anime_details 為 null">
            <p>
              此作品沒有動畫化紀錄（<code className="mono">anime_status</code> ={' '}
              {animeStatusLabel(work.anime_status)}），因此巢狀物件為 null。
            </p>
            <p className="mt-1">
              巢狀欄位清單：{nestedRows('anime_details', null).map((row) => row.label).join('、')}
              ——全部為 <span className="unknown-value">unknown</span>。
            </p>
          </EmptyState>
        ) : (
          <NestedTable rows={nestedRows('anime_details', work.anime_details as unknown as Record<string, unknown>)} />
        )}
      </SectionCard>

      <SectionCard
        id="official-zh-cn"
        title="簡中官方授權（official_zh_cn）"
        subtitle="必須區分「實體書（有 ISBN）」與「數位授權（無 ISBN）」。"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">授權形式：</span>
            <Pill tone="plain">{officialZhCnKindLabel(work.official_zh_cn.kind)}</Pill>
            <Pill tone={work.official_zh_cn.exists ? 'official' : 'none'}>
              exists = {String(work.official_zh_cn.exists)}
            </Pill>
          </div>
          <NestedTable
            rows={nestedRows('official_zh_cn', work.official_zh_cn as unknown as Record<string, unknown>)}
          />
        </div>
      </SectionCard>

      <SectionCard
        id="unofficial-zh"
        title="非官方漢化（unofficial_zh）"
        subtitle="僅人工登記，且資料結構中不存在任何連結欄位（schema D1）。"
      >
        <UnofficialZhPanel unofficial={work.unofficial_zh} />
      </SectionCard>

      <SectionCard
        id="volumes"
        title="書目（ja_volumes / zh_tw_volumes / zh_cn_volumes）"
        subtitle="三份清單的欄位集合不同：日文版含價格與封面圖 URL，中文版含譯者。"
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">
              日文版書目（ja_volumes，{work.ja_volumes.length} 筆）
            </h3>
            <VolumeTable volumes={work.ja_volumes} nestedKey="ja_volumes" title="日文版書目" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">
              繁中版書目（zh_tw_volumes，{work.zh_tw_volumes.length} 筆）
            </h3>
            <VolumeTable volumes={work.zh_tw_volumes} nestedKey="zh_tw_volumes" title="繁中版書目" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">
              簡中版書目（zh_cn_volumes，{work.zh_cn_volumes.length} 筆）
            </h3>
            <VolumeTable volumes={work.zh_cn_volumes} nestedKey="zh_cn_volumes" title="簡中版書目" />
          </div>
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Evaluation layers [A] and [B]
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="ratings"
        title="評分（ratings）— 評價三層模型的 [A] 層"
        subtitle={`${work.ratings.length} 筆聚合評分。只存分數、口徑與件數，不含評論正文。`}
      >
        <RatingPanel ratings={work.ratings} />
      </SectionCard>

      <SectionCard
        id="review-meta"
        title="書評／榜單元資料（review_meta）— [B] 層"
        subtitle={`${work.review_meta.length} 筆元資料。資料庫沒有評論正文欄位（P1）。`}
      >
        <ReviewMetaList items={work.review_meta} />
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Sources + raw confidence/source maps
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="sources"
        title={`溯源來源（sources，${work.sources.length} 筆）`}
        subtitle="schema 要求每筆來源必須帶 url / retrieved_at / confidence。"
      >
        <SourceList sources={work.sources} />
      </SectionCard>

      <SectionCard
        id="field-confidence"
        title={`欄位級把握度（field_confidence，${confidenceKeys.length} 個欄位）`}
        subtitle="「來源可信」與「這個欄位填得對」是兩件事，因此分開記錄。"
      >
        {confidenceKeys.length === 0 ? (
          <EmptyState title="此紀錄沒有任何 field_confidence 值">
            管線尚未為此作品寫入欄位級把握度。
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="field-table min-w-[26rem]">
              <thead>
                <tr>
                  <th>欄位</th>
                  <th>把握度</th>
                </tr>
              </thead>
              <tbody>
                {confidenceKeys.map((key) => (
                  <tr key={key}>
                    <th>
                      <span className="mono">{key}</span>
                    </th>
                    <td>
                      <ConfidenceBar confidence={work.field_confidence[key]} />
                      <span className="ml-2 tabular-nums text-xs text-zinc-600">
                        {work.field_confidence[key]}
                      </span>
                    </td>
                  </tr>
                ))}
                {extraConfidenceRows.map((row) => (
                  <tr key={`extra-${row.key}`}>
                    <th>
                      <span className="mono">{row.key}</span>
                      <span className="block text-xs text-zinc-500">（不在 Work 欄位清單中）</span>
                    </th>
                    <td>
                      <ConfidenceBar confidence={row.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        id="field-sources"
        title={`欄位級溯源原始紀錄（field_sources，${fieldSourceKeys.length} 個欄位）`}
        subtitle="上表的依據欄即由此物件產生；此處列出未對應到任何 Work 欄位的鍵（如果有的話）。"
      >
        {extraSourceRows.length === 0 ? (
          <p className="text-sm text-zinc-700">
            全部 {fieldSourceKeys.length} 個鍵都對應到 Work 的欄位，並已在上方各表中逐欄位呈現。
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {extraSourceRows.map((row) => (
              <li key={row.key} className="rounded border border-zinc-200 p-2">
                <span className="mono">{row.key}</span> <BasisBadge basis={row.source.basis} />
                {row.source.note ? <p className="text-xs text-zinc-600">{row.source.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        id="raw"
        title="原始紀錄（raw record）"
        subtitle="可直接核對上表是否遺漏任何欄位；此為管線輸出的原文。"
      >
        <details>
          <summary className="cursor-pointer text-sm text-zinc-700">
            展開 {Object.keys(work).length} 個頂層鍵的 JSON
          </summary>
          <pre className="mono mt-3 max-h-[32rem] overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
            {JSON.stringify(work, null, 2)}
          </pre>
        </details>
      </SectionCard>
    </div>
  );
}
