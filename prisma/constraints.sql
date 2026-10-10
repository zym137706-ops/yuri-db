-- =============================================================================
-- 追加约束（Prisma schema 无法表达的部分）
-- =============================================================================
-- 用法：在 `prisma migrate dev` 生成基础表结构之后执行本文件。
--   psql "$DATABASE_URL" -f prisma/constraints.sql
-- 建议同时加入 prisma/migrations 的尾部，或在 CI 里作为独立步骤执行。
--
-- 这些约束把「阶段 1 确认的三项决策」变成**数据库层强制**，
-- 而不是只写在文档里靠人自觉。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [D1] 非官方汉化：纯人工登记，禁止任何链接
-- -----------------------------------------------------------------------------
-- schema.prisma 里 Work 刻意没有 unofficialZh 的 URL 字段；
-- 这里再加一道闸：人工备注里也不允许出现 http/www。
ALTER TABLE "Work"
  DROP CONSTRAINT IF EXISTS work_unofficial_zh_no_link;

ALTER TABLE "Work"
  ADD CONSTRAINT work_unofficial_zh_no_link
  CHECK (
    "unofficialZhNote" IS NULL
    OR (
      "unofficialZhNote" !~* 'https?://'
      AND "unofficialZhNote" !~* 'www\.'
      -- 裸域名也拦截（example.com 这类）
      AND "unofficialZhNote" !~* '[a-z0-9-]+\.[a-z]{2,}'
    )
  );

COMMENT ON COLUMN "Work"."unofficialZhNote" IS
  '[D1] 非官方汉化人工备注。仅记录存在性，禁止包含任何 URL 或获取方式。';

-- status = unknown 时不得填写章节/日期（避免留下未经验证的痕迹）
ALTER TABLE "Work"
  DROP CONSTRAINT IF EXISTS work_unofficial_zh_unknown_clean;

ALTER TABLE "Work"
  ADD CONSTRAINT work_unofficial_zh_unknown_clean
  CHECK (
    "unofficialZhStatus" <> 'unknown'
    OR ("unofficialZhLatestChapter" IS NULL AND "unofficialZhLastSeen" IS NULL)
  );

-- 人工登记者必须留下登记时间，便于审计
ALTER TABLE "Work"
  DROP CONSTRAINT IF EXISTS work_unofficial_zh_registrar;

ALTER TABLE "Work"
  ADD CONSTRAINT work_unofficial_zh_registrar
  CHECK (
    "unofficialZhStatus" <> 'manually_flagged'
    OR ("unofficialZhRecordedBy" IS NOT NULL AND "unofficialZhRecordedAt" IS NOT NULL)
  );

-- -----------------------------------------------------------------------------
-- [D2] 溯源：官方类字段必须有 sourceUrl；editorial 类可空
-- -----------------------------------------------------------------------------
ALTER TABLE "Citation"
  DROP CONSTRAINT IF EXISTS citation_source_url_required;

ALTER TABLE "Citation"
  ADD CONSTRAINT citation_source_url_required
  CHECK (
    "basis" = 'editorial'
    OR "sourceUrl" IS NOT NULL
  );

-- Confidence 必须在 [0,1]
ALTER TABLE "Citation"
  DROP CONSTRAINT IF EXISTS citation_confidence_range;

ALTER TABLE "Citation"
  ADD CONSTRAINT citation_confidence_range
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

-- -----------------------------------------------------------------------------
-- [D3] 采集运行：网络失败与站点拒绝必须分开（不允许把两者混为一谈）
-- -----------------------------------------------------------------------------
ALTER TABLE "CrawlRun"
  DROP CONSTRAINT IF EXISTS crawlrun_network_error_has_message;

ALTER TABLE "CrawlRun"
  ADD CONSTRAINT crawlrun_network_error_has_message
  CHECK (
    "status" NOT IN ('network_error', 'blocked_by_robots', 'failed')
    OR "error" IS NOT NULL
  );

-- do_not_collect 的源不允许产生成功的采集运行记录
ALTER TABLE "CrawlRun"
  DROP CONSTRAINT IF EXISTS crawlrun_runner_required;

ALTER TABLE "CrawlRun"
  ADD CONSTRAINT crawlrun_runner_required
  CHECK ("runner" IS NULL OR "runner" IN ('github_actions', 'local_dev', 'manual'));

-- -----------------------------------------------------------------------------
-- 数据完整性
-- -----------------------------------------------------------------------------
-- ISBN 必须是 13 位数字（或无值）
ALTER TABLE "Volume"
  DROP CONSTRAINT IF EXISTS volume_isbn_format;

ALTER TABLE "Volume"
  ADD CONSTRAINT volume_isbn_format
  CHECK ("isbn" IS NULL OR "isbn" ~ '^[0-9]{13}$');

-- 卷次必须为正
ALTER TABLE "Volume"
  DROP CONSTRAINT IF EXISTS volume_number_positive;

ALTER TABLE "Volume"
  ADD CONSTRAINT volume_number_positive
  CHECK ("volumeNumber" >= 1);

-- 评分口径只能是 5 / 10 / 100（不同口径不得合并计算）
ALTER TABLE "RatingSnapshot"
  DROP CONSTRAINT IF EXISTS rating_score_scale_allowed;

ALTER TABLE "RatingSnapshot"
  ADD CONSTRAINT rating_score_scale_allowed
  CHECK ("scoreScale" IN (5, 10, 100));

-- 评分必须落在其口径范围内
ALTER TABLE "RatingSnapshot"
  DROP CONSTRAINT IF EXISTS rating_score_in_scale;

ALTER TABLE "RatingSnapshot"
  ADD CONSTRAINT rating_score_in_scale
  CHECK ("scoreValue" >= 0 AND "scoreValue" <= "scoreScale");

-- 合并目标不能指向自己
ALTER TABLE "Work"
  DROP CONSTRAINT IF EXISTS work_merge_not_self;

ALTER TABLE "Work"
  ADD CONSTRAINT work_merge_not_self
  CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");

-- -----------------------------------------------------------------------------
-- 反盗版：源 URL 白名单式防御（可选，建议启用）
-- -----------------------------------------------------------------------------
-- 本项目所有入库 URL 都应指向已登记的来源。可在应用层校验，
-- 也可在 DB 层用触发器拦截已知域名。此处仅登记意图，不作强制，
-- 因为域名清单会变化，硬编码在 DB 里维护成本高。
-- 实际执行由 scripts/validate.py 的 denylist 检查承担
-- （见 research/compliance_check.py 的同名机制）。
COMMENT ON TABLE "Source" IS
  '数据源登记表。仅登记合法公开来源；禁止盗版/汉化站进入本表。';

-- -----------------------------------------------------------------------------
-- 百合动画（Anime）追加约束
-- -----------------------------------------------------------------------------
-- Yuri 标签相关度必须是 0..100
ALTER TABLE "Anime"
  DROP CONSTRAINT IF EXISTS anime_yuri_rank_range;
ALTER TABLE "Anime"
  ADD CONSTRAINT anime_yuri_rank_range
  CHECK ("yuriTagRank" IS NULL OR ("yuriTagRank" >= 0 AND "yuriTagRank" <= 100));

-- 站内政策排除 R18：数据库层也不允许出现
ALTER TABLE "Anime"
  DROP CONSTRAINT IF EXISTS anime_no_adult;
ALTER TABLE "Anime"
  ADD CONSTRAINT anime_no_adult
  CHECK ("isAdult" = false);

-- 封面只存链接：不允许出现 data: / file: 之类的内嵌或本地路径（等于变相镜像）
ALTER TABLE "Anime"
  DROP CONSTRAINT IF EXISTS anime_cover_is_link;
ALTER TABLE "Anime"
  ADD CONSTRAINT anime_cover_is_link
  CHECK ("coverUrl" IS NULL OR "coverUrl" ~* '^https?://');

ALTER TABLE "Work"
  DROP CONSTRAINT IF EXISTS work_cover_is_link;
ALTER TABLE "Work"
  ADD CONSTRAINT work_cover_is_link
  CHECK ("coverUrl" IS NULL OR "coverUrl" ~* '^https?://');

-- 评分与集数不得为负
ALTER TABLE "Anime"
  DROP CONSTRAINT IF EXISTS anime_counts_non_negative;
ALTER TABLE "Anime"
  ADD CONSTRAINT anime_counts_non_negative
  CHECK (
    ("episodeCount" IS NULL OR "episodeCount" >= 0)
    AND ("episodeDurationMin" IS NULL OR "episodeDurationMin" >= 0)
    AND ("averageScore" IS NULL OR ("averageScore" >= 0 AND "averageScore" <= 100))
  );

COMMENT ON TABLE "Anime" IS
  '百合动画目录。独立于 Work：原创动画与剧场版没有漫画/小说原作，workId 可为空。';
