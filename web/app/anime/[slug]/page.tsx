/**
 * Anime detail page — app/anime/[slug]/page.tsx
 *
 * Requirement: render EVERY field defined by schemas/anime.schema.json, each with
 * its `field_sources` provenance and its `field_confidence` value, plus the two
 * fields this feature exists for — 主要聲優（角色＋聲優）and 製作公司 — and the
 * 開播時間 in full precision.
 *
 * The field inventory is driven by lib/anime-fields.json (asserted to be a
 * bijection with the schema's `properties` by scripts/verify-anime.mjs), so a
 * field cannot silently disappear from this page. A raw-record disclosure at the
 * bottom lets a reader verify that nothing was hidden.
 *
 * Provenance is first-class here in a stronger sense than for Work: EVERY field of
 * EVERY anime entry is `basis: "third_party"` (AniList), so the page says so once
 * per section rather than implying any of it is an official announcement.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { CoverImage } from '@/components/CoverImage';
import { ProvenanceTable } from '@/components/ProvenanceTable';
import { SourceList } from '@/components/SourceList';
import { TitleTriple } from '@/components/TitleTriple';
import { BasisBadge, ConfidenceBar, EmptyState, Pill, SectionCard, UnknownValue } from '@/components/ui';
import { getWorkBySlug } from '@/lib/data';
import externalLinks from '@/lib/external-links.json';
import {
  ANIME_FIELD_DESCRIPTORS,
  animeConfidenceExtras,
  animeFieldViewsByGroup,
  animeNestedRows,
  animeSourceExtras,
  buildAnimeFieldViews,
  getAnimeBySlug,
  getAnimeSlugs,
  summarizeAnimeProvenance,
} from '@/lib/anime';
import {
  ADAPTATION_SOURCE_LABELS,
  ANIME_FORMAT_LABELS,
  UNRECORDED_ZH_TITLE_NOTE,
  adaptationSourceLabel,
  animeFormatLabel,
  animeSeasonLabel,
  animeStatusLabel,
} from '@/lib/anime-labels';
import { confidencePercent, formatTimestamp, isBlank } from '@/lib/policy';
import type { Work } from '@/lib/types';

type Params = { slug: string };

/** Pre-render one page per anime entry at build time. */
export function generateStaticParams(): Params[] {
  return getAnimeSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const anime = getAnimeBySlug(slug);
  if (!anime) return { title: '找不到動畫條目' };
  return {
    title: `${anime.title_ja}（${anime.slug}）`,
    description: `${anime.title_ja} 的開播時間、主要聲優、製作公司與逐欄位溯源（來源為 AniList，第三方資料庫）。`,
  };
}

/** A definition-list row that never hides a field: null renders as "unknown". */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-zinc-500">{label}：</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function valueOrUnknown(value: string | number | null | undefined) {
  if (isBlank(value)) return <UnknownValue />;
  return <>{value}</>;
}

function RelatedWork({ animeSlug, workId, workSlug }: { animeSlug: string; workId: string | null; workSlug: string | null }) {
  if (!workId && !workSlug) {
    return (
      <EmptyState title="沒有關聯的 Work 條目">
        <p>
          此動畫在 <code className="mono">related_work_id</code> / <code className="mono">related_work_slug</code> 皆為 null，
          表示管線沒有把它連到本站的漫畫／輕小說 Work 庫（原創動畫與劇場版多屬此類）。
        </p>
      </EmptyState>
    );
  }

  let work: Work | undefined;
  try {
    work = workSlug ? getWorkBySlug(workSlug) : undefined;
  } catch {
    // works.json unreadable — fall back to the raw identifiers below.
    work = undefined;
  }

  return (
    <div className="space-y-2 text-sm">
      {work ? (
        <p>
          <Link href={`/works/${work.slug}`} className="font-medium">
            {work.title_ja}
          </Link>
          <span className="ml-2 text-xs text-zinc-500">本站 Work 庫中的原作條目</span>
        </p>
      ) : (
        <p className="text-zinc-700">
          管線標記了關聯 Work（slug <code className="mono">{workSlug ?? 'null'}</code>），
          但目前的 <code className="mono">data/works.json</code> 匯出中找不到這個 slug，
          因此不產生可能 404 的站內連結。
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <Fact label="related_work_id">
          <span className="mono">{valueOrUnknown(workId)}</span>
        </Fact>
        <Fact label="related_work_slug">
          <span className="mono">{valueOrUnknown(workSlug)}</span>
        </Fact>
      </dl>
      <p className="text-xs text-zinc-500">
        動畫條目：<Link href={`/anime/${animeSlug}`} className="mono">{animeSlug}</Link>
      </p>
    </div>
  );
}

export default async function AnimeDetailPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const anime = getAnimeBySlug(slug);

  if (!anime) notFound();

  const groups = animeFieldViewsByGroup(anime);
  const allViews = buildAnimeFieldViews(anime);
  const summary = summarizeAnimeProvenance(allViews);
  const confidenceKeys = Object.keys(anime.field_confidence ?? {});
  const fieldSourceKeys = Object.keys(anime.field_sources ?? {});
  const confidenceExtras = animeConfidenceExtras(anime);
  const sourceExtras = animeSourceExtras(anime);
  const cast = anime.main_cast ?? [];
  const castWithoutVoiceActor = cast.filter((member) => !member.voice_actor).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/anime" className="text-sm text-zinc-600 no-underline hover:text-zinc-900">
          ← 回百合動畫列表
        </Link>
        <span className="text-xs text-zinc-500">
          最後查核：{formatTimestamp(anime.last_checked)} · ID <code className="mono">{anime.id}</code>
        </span>
      </div>

      {/* ---------------------------------------------------------------- *
       * Identity + the three facts the feature exists for
       * ---------------------------------------------------------------- */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row">
          <CoverImage work={anime} size="detail" sourceTag="AniList" attribution="© 版權持有人" />

          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">{anime.title_ja}</h1>

            <p className="text-sm text-zinc-600">
              {anime.title_romaji ?? <UnknownValue label="羅馬字 unknown" />}
              {' · '}
              {anime.title_en ?? <UnknownValue label="英文標題 unknown" />}
            </p>

            <div className="flex flex-wrap gap-1.5">
              <Pill tone="plain" title={`format = ${anime.format}`}>
                形態：{animeFormatLabel(anime.format)}
              </Pill>
              <Pill tone="plain" title={`adaptation_source = ${anime.adaptation_source}`}>
                改編：{adaptationSourceLabel(anime.adaptation_source)}
              </Pill>
              <Pill tone={anime.status === 'announced' ? 'accent' : 'plain'} title={`status = ${anime.status}`}>
                狀態：{animeStatusLabel(anime.status)}
              </Pill>
              <BasisBadge basis="third_party" />
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Fact label="開播時間（start_date）">
                <span className="font-medium text-zinc-900">{valueOrUnknown(anime.start_date)}</span>
              </Fact>
              <Fact label="結束時間（end_date）">{valueOrUnknown(anime.end_date)}</Fact>
              <Fact label="季（season / season_year）">
                {anime.season ? (
                  <>
                    {animeSeasonLabel(anime.season)} {anime.season_year ?? ''}
                    {anime.season_year ? '' : <span className="text-zinc-400">（季年份 unknown）</span>}
                  </>
                ) : (
                  <UnknownValue />
                )}
              </Fact>
              <Fact label="集數（episode_count）">{valueOrUnknown(anime.episode_count)}</Fact>
              <Fact label="單集時長（episode_duration_min）">
                {isBlank(anime.episode_duration_min) ? <UnknownValue /> : <>{anime.episode_duration_min} 分鐘</>}
              </Fact>
              <Fact label="製作公司（studios）">
                {anime.studios.length > 0 ? (
                  <span className="font-medium text-zinc-900">{anime.studios.join('、')}</span>
                ) : (
                  <UnknownValue label="未收錄" />
                )}
              </Fact>
              <Fact label="AniList ID">
                {anime.anilist_id === null ? (
                  <UnknownValue />
                ) : (
                  <a
                    href={anime.source_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mono"
                    title="本條目的資料來源頁（AniList）"
                  >
                    {anime.anilist_id}
                  </a>
                )}
              </Fact>
              <Fact label="MyAnimeList ID">
                {anime.mal_id === null ? (
                  <UnknownValue />
                ) : (
                  <a
                    href={`${externalLinks.myanimelist_anime}${anime.mal_id}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mono"
                    title="依 MyAnimeList 的 /anime/<id> 規則組出的網址；本站未向 MAL 查證此對應"
                  >
                    {anime.mal_id}
                  </a>
                )}
              </Fact>
              <Fact label="來源頁（source_url）">
                <a href={anime.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mono">
                  {anime.source_url}
                </a>
              </Fact>
            </dl>

            <p className="text-xs text-zinc-500">
              開播時間的精度依來源而異：可能是 <code className="mono">YYYY</code>、<code className="mono">YYYY-MM</code> 或{' '}
              <code className="mono">YYYY-MM-DD</code>；本站照原文顯示，不補齊、不推測。已宣布動畫化但未定檔者為 null，
              顯示 <UnknownValue label="未定／unknown" />。
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- *
       * Three titles — always rendered, including the missing ones
       * ---------------------------------------------------------------- */}
      <SectionCard
        title="三語標題"
        subtitle="title_ja / title_zh_tw / title_zh_cn 一律渲染，null 一律寫「未收錄」，並說明原因。"
      >
        <TitleTriple work={anime} missingLabel="未收錄（來源未提供）" />
        <div className="callout callout-info mt-3 text-xs text-zinc-700">
          <p>{UNRECORDED_ZH_TITLE_NOTE}</p>
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * 主要聲優（角色 + 聲優）
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="main-cast"
        title={`主要聲優（main_cast，${cast.length} 筆）`}
        subtitle="角色與聲優成對呈現；聲優為 null 時顯示 unknown，不省略該列。"
      >
        {cast.length === 0 ? (
          <EmptyState title="此條目沒有主要聲優資料" tone="warn">
            <p>
              <code className="mono">main_cast</code> 為空陣列。AniList 對 OVA／特別篇／音樂影像常缺少
              MAIN 角色名單；本站不補齊、不臆測。
            </p>
          </EmptyState>
        ) : (
          <>
            {castWithoutVoiceActor > 0 ? (
              <p className="mb-2 text-xs text-amber-800">
                其中 {castWithoutVoiceActor} 筆角色在來源中沒有對應的日語聲優（顯示 <span className="unknown-value">聲優 unknown</span>）。
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="field-table min-w-[28rem]">
                <thead>
                  <tr>
                    <th className="w-[3rem]">#</th>
                    <th>角色（character）</th>
                    <th>聲優（voice_actor）</th>
                  </tr>
                </thead>
                <tbody>
                  {cast.map((member, index) => (
                    <tr key={`${member.character}-${index}`}>
                      <td className="tabular-nums text-zinc-500">{index + 1}</td>
                      <td className="font-medium text-zinc-800">{member.character}</td>
                      <td>{member.voice_actor ?? <UnknownValue label="聲優 unknown" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * 製作公司
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="studios"
        title={`製作公司（studios，${anime.studios.length} 家）`}
        subtitle="只收 AniList 標記 isMain: true 的動畫製作業者。"
      >
        {anime.studios.length === 0 ? (
          <EmptyState title="未收錄製作公司" tone="warn">
            <p>
              <code className="mono">studios</code> 為空陣列。這代表來源沒有提供（或未標記 isMain: true），
              而不是「這部動畫沒有製作公司」；本站不推測、不從其他欄位回填。
            </p>
          </EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {anime.studios.map((studio) => (
              <li key={studio}>
                <Link href={`/anime?studio=${encodeURIComponent(studio)}`} className="badge badge-plain no-underline">
                  {studio}
                  <span className="ml-1 text-[10px] text-zinc-400">看同公司作品</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Related Work
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="related-work"
        title="關聯作品（related_work_id / related_work_slug）"
        subtitle="若原作就在本站漫畫／輕小說 Work 庫中，這裡會連過去。"
      >
        <RelatedWork animeSlug={anime.slug} workId={anime.related_work_id} workSlug={anime.related_work_slug} />
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Provenance overview
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="provenance-summary"
        title="溯源總覽"
        subtitle="本頁所有欄位依 field_sources 標示依據；null／空值一律顯示 unknown。"
      >
        <div className="space-y-3">
          <div className="callout callout-warn text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <BasisBadge basis="third_party" />
              <span>
                本條目 <strong>{fieldSourceKeys.length}</strong> 個欄位級來源紀錄
                {summary.thirdParty > 0 ? <>（其中 {summary.thirdParty} 個欄位的依據為 third_party）</> : null}
                ，全部來自 AniList 這個<strong>第三方、使用者可編輯的資料庫</strong>。
                本站沒有任何一個動畫欄位是官方來源（<code className="mono">basis: official</code> 數量為{' '}
                {summary.official}）；開播時間、聲優、製作公司在官方公告前都可能變動。
              </span>
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">欄位總數</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.total}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有值的欄位</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.total - summary.unknown}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">unknown</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.unknown}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有溯源紀錄</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.sourced}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">有值但無溯源</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.unsourced}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-2">
              <dt className="text-xs text-zinc-500">第三方依據</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.thirdParty}</dd>
            </div>
          </dl>

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
            。這是「這個欄位填得多確定」的自我評估，不是官方確認；個別欄位請見下表。
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
       * sources[] — the record-level provenance
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="sources"
        title={`溯源來源（sources，${anime.sources.length} 筆）`}
        subtitle="schema 要求每筆來源必須帶 url / retrieved_at / confidence。"
      >
        <SourceList sources={anime.sources} />
        <div className="callout callout-warn mt-3 text-xs text-zinc-700">
          <p className="font-semibold text-zinc-800">AniList 不是官方來源</p>
          <p className="mt-1">
            上面的 <code className="mono">sources[]</code> 是本條目唯一的來源：AniList GraphQL API。
            AniList 由使用者共同編輯，並非出版社、製作公司或官方網站的公告。本站只鏡像「作品介紹所需的欄位」
            （AniList ToS 禁止全量鏡像），並保留取得時間與把握度；請以官方網站為最終依據。
          </p>
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * field_confidence — including the pipeline's non-field aliases
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="field-confidence"
        title={`欄位級把握度（field_confidence，${confidenceKeys.length} 個鍵）`}
        subtitle="「來源可信」與「這個欄位填得對」是兩件事，因此分開記錄。"
      >
        {confidenceKeys.length === 0 ? (
          <EmptyState title="此條目沒有任何 field_confidence 值">管線尚未為此動畫寫入欄位級把握度。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="field-table min-w-[26rem]">
              <thead>
                <tr>
                  <th>鍵</th>
                  <th>把握度</th>
                </tr>
              </thead>
              <tbody>
                {confidenceKeys.map((key) => (
                  <tr key={key}>
                    <th>
                      <span className="mono">{key}</span>
                      {confidenceExtras.some((extra) => extra.key === key) ? (
                        <span className="block text-xs text-zinc-500">（不是 schema 欄位名，見下方說明）</span>
                      ) : null}
                    </th>
                    <td>
                      <ConfidenceBar confidence={anime.field_confidence[key]} />
                      <span className="ml-2 tabular-nums text-xs text-zinc-600">{anime.field_confidence[key]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confidenceExtras.length > 0 ? (
          <div className="callout callout-info mt-3 text-xs text-zinc-700">
            <p className="font-semibold text-zinc-800">這些鍵不是 schema 欄位名</p>
            <p className="mt-1">
              管線寫入的 <code className="mono">{confidenceExtras.map((extra) => extra.key).join('、')}</code>{' '}
              對應的是「製作公司／播出資訊／聲優名單」這幾組資料，但{' '}
              <code className="mono">schemas/anime.schema.json</code> 沒有同名欄位。
              本站<strong>不代為對應</strong>到 studios / start_date / main_cast
              （那會是編造對應關係），只照原文列出。詳見{' '}
              <Link href="/data-quality">資料品質</Link>。
            </p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        id="field-sources"
        title={`欄位級溯源原始紀錄（field_sources，${fieldSourceKeys.length} 個欄位）`}
        subtitle="上表的依據欄即由此物件產生；此處列出未對應到任何 schema 欄位的鍵（如果有的話）。"
      >
        {sourceExtras.length === 0 ? (
          <p className="text-sm text-zinc-700">
            全部 {fieldSourceKeys.length} 個鍵都對應到動畫 schema 的欄位，並已在上方各表中逐欄位呈現。
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sourceExtras.map((row) => (
              <li key={row.key} className="rounded border border-zinc-200 p-2">
                <span className="mono">{row.key}</span> <BasisBadge basis={row.source.basis} />
                {row.source.note ? <p className="text-xs text-zinc-600">{row.source.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---------------------------------------------------------------- *
       * Nested main_cast rows (field-by-field, so nothing is hidden)
       * ---------------------------------------------------------------- */}
      <SectionCard
        id="main-cast-rows"
        title="主要聲優的巢狀欄位"
        subtitle="main_cast 是巢狀物件；這裡逐欄位列出去重複欄位定義，缺值顯示 unknown。"
      >
        {cast.length === 0 ? (
          <EmptyState title="main_cast 為空陣列">
            <p>
              巢狀欄位清單：{animeNestedRows('main_cast', null).map((row) => row.label).join('、')}
              ——全部為 <span className="unknown-value">unknown</span>。
            </p>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="field-table min-w-[34rem]">
              <thead>
                <tr>
                  <th className="w-[3rem]">#</th>
                  {animeNestedRows('main_cast', cast[0] as unknown as Record<string, unknown>).map((row) => (
                    <th key={row.name}>
                      {row.label}
                      <span className="mono block text-xs text-zinc-400">{row.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cast.map((member, index) => {
                  const rows = animeNestedRows('main_cast', member as unknown as Record<string, unknown>);
                  return (
                    <tr key={`${member.character}-row-${index}`}>
                      <td className="tabular-nums text-zinc-500">{index + 1}</td>
                      {rows.map((row) => (
                        <td key={row.name}>{row.isUnknown ? <UnknownValue /> : row.value}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        id="raw"
        title="原始紀錄（raw record）"
        subtitle="可直接核對上表是否遺漏任何欄位；此為管線輸出的原文。"
      >
        <details>
          <summary className="cursor-pointer text-sm text-zinc-700">
            展開 {Object.keys(anime).length} 個頂層鍵的 JSON（欄位清單共 {ANIME_FIELD_DESCRIPTORS.length} 個）
          </summary>
          <pre className="mono mt-3 max-h-[32rem] overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
            {JSON.stringify(anime, null, 2)}
          </pre>
        </details>
      </SectionCard>

      <p className="text-xs text-zinc-500">
        標籤對照：形態 <code className="mono">{Object.keys(ANIME_FORMAT_LABELS).join(' / ')}</code>；改編類型{' '}
        <code className="mono">{Object.keys(ADAPTATION_SOURCE_LABELS).join(' / ')}</code>。
      </p>
    </div>
  );
}
