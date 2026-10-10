/**
 * Builds the field-by-field view models for the Work detail page.
 *
 * The field inventory (and its labels) comes from lib/schema-fields.json, which
 * `scripts/assert-data-contract.mjs` proves is a bijection with the `properties`
 * of `schemas/work.schema.json`. Nothing here may hide a field: a null/empty
 * value becomes the literal "unknown".
 */
import schemaFields from './schema-fields.json';
import {
  ANIME_FORMAT_LABELS,
  ANIME_STATUS_LABELS,
  BASIS_LABELS,
  CLASSIFICATION_BASIS_LABELS,
  MEDIA_TYPE_LABELS,
  OFFICIAL_ZH_CN_KIND_LABELS,
  PLATFORM_KIND_LABELS,
  REGION_LABELS,
  SERIALIZATION_STATUS_LABELS,
  UNOFFICIAL_ZH_STATUS_LABELS,
  YURI_TYPE_LABELS,
  labelOf,
} from './labels';
import {
  UNKNOWN_TEXT,
  displayValue,
  formatDate,
  formatTimestamp,
  isBlank,
} from './policy';
import type { FieldBasis, FieldSource, FieldView, Work } from './types';

/* -------------------------------------------------------------------------- *
 * Field inventory
 * -------------------------------------------------------------------------- */

export interface FieldDescriptor {
  name: string;
  label: string;
  kind: string;
  group?: string;
}

interface SchemaFieldsFile {
  groups: { id: string; label: string }[];
  workFields: FieldDescriptor[];
  nested: Record<string, FieldDescriptor[]>;
}

const SCHEMA_FIELDS = schemaFields as unknown as SchemaFieldsFile;

export const FIELD_GROUPS = SCHEMA_FIELDS.groups;
export const WORK_FIELD_DESCRIPTORS: FieldDescriptor[] = SCHEMA_FIELDS.workFields;
export const NESTED_FIELD_DESCRIPTORS: Record<string, FieldDescriptor[]> = SCHEMA_FIELDS.nested;

/** Label for any field name — top-level or nested. Falls back to the raw name. */
export function fieldLabel(name: string): string {
  const top = WORK_FIELD_DESCRIPTORS.find((f) => f.name === name);
  if (top) return top.label;
  for (const list of Object.values(NESTED_FIELD_DESCRIPTORS)) {
    const hit = list.find((f) => f.name === name);
    if (hit) return hit.label;
  }
  return name;
}

/** Per-field enum label maps, so an enum value renders as Chinese + keeps its token. */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  media_type: MEDIA_TYPE_LABELS,
  serialization_status: SERIALIZATION_STATUS_LABELS,
  yuri_type: YURI_TYPE_LABELS,
  classification_basis: CLASSIFICATION_BASIS_LABELS,
  anime_status: ANIME_STATUS_LABELS,
  magazine_or_platform_kind: PLATFORM_KIND_LABELS,
  kind: OFFICIAL_ZH_CN_KIND_LABELS,
  format: ANIME_FORMAT_LABELS,
  status: UNOFFICIAL_ZH_STATUS_LABELS,
  region: REGION_LABELS,
  basis: BASIS_LABELS,
};

/* -------------------------------------------------------------------------- *
 * Value formatting
 * -------------------------------------------------------------------------- */

function formatByKind(kind: string, raw: unknown): { value: string; token: string | null } {
  if (isBlank(raw)) return { value: UNKNOWN_TEXT, token: null };

  switch (kind) {
    case 'boolean':
      return { value: raw === true ? '是' : raw === false ? '否' : UNKNOWN_TEXT, token: null };
    case 'number':
      return { value: typeof raw === 'number' ? String(raw) : String(raw), token: null };
    case 'date':
      return { value: formatDate(typeof raw === 'string' ? raw : String(raw)), token: null };
    case 'timestamp':
      return { value: formatTimestamp(typeof raw === 'string' ? raw : String(raw)), token: null };
    case 'stringArray':
      return {
        value: Array.isArray(raw) ? raw.map((v) => String(v)).join('、') : displayValue(raw),
        token: null,
      };
    case 'url':
      return { value: typeof raw === 'string' ? raw : String(raw), token: null };
    case 'object': {
      // Objects are rendered in full by their own section further down the page;
      // the table shows a truthful summary instead of "[object Object]".
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as object).length : 0;
      return { value: `（物件，${keys} 個欄位；詳見下方章節）`, token: null };
    }
    case 'objectArray': {
      const count = Array.isArray(raw) ? raw.length : 0;
      return { value: `（${count} 筆；詳見下方章節）`, token: null };
    }
    case 'confidenceMap': {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as object).length : 0;
      return { value: `（${keys} 個欄位有把握度值；詳見下方章節）`, token: null };
    }
    default:
      return { value: displayValue(raw), token: typeof raw === 'string' ? raw : null };
  }
}

/** Enum-aware formatting: returns both the 中文 label and the raw token. */
function formatEnum(fieldName: string, raw: unknown): string {
  if (isBlank(raw)) return UNKNOWN_TEXT;
  const map = ENUM_LABELS[fieldName];
  const token = String(raw);
  return map ? labelOf(map, token) : token;
}

/* -------------------------------------------------------------------------- *
 * Field views
 * -------------------------------------------------------------------------- */

function resolveSource(work: Work, fieldName: string): FieldSource | null {
  const entry = work.field_sources?.[fieldName];
  return entry ?? null;
}

function buildView(work: Work, descriptor: FieldDescriptor): FieldView {
  const raw = (work as unknown as Record<string, unknown>)[descriptor.name];
  const isUnknown = isBlank(raw);
  const source = resolveSource(work, descriptor.name);
  const confidence =
    typeof work.field_confidence?.[descriptor.name] === 'number'
      ? work.field_confidence[descriptor.name]
      : (source?.confidence ?? null);

  let value: string;
  let token: string | null = null;
  if (descriptor.kind === 'enum') {
    value = formatEnum(descriptor.name, raw);
    token = isUnknown ? null : String(raw);
  } else {
    const formatted = formatByKind(descriptor.kind, raw);
    value = formatted.value;
    token = formatted.token;
  }

  const basis: FieldBasis | null = source?.basis ?? null;
  const editorial = basis === 'editorial';

  return {
    field: descriptor.name,
    label: descriptor.label,
    value,
    isUnknown,
    raw,
    token,
    source,
    confidence,
    basis,
    editorial,
    // Editorial fields DO sometimes carry a context URL in the pipeline output
    // (e.g. genres marked editorial with the magazine's page). The requirement is
    // that no source link is shown for an editorial judgement, so the linkable URL
    // is forced to null here — making the suppression a data-layer guarantee that
    // the provenance table cannot bypass, rather than a component convention.
    linkableSourceUrl: editorial ? null : (source?.source_url || null),
    state: isUnknown ? 'unknown' : source ? 'sourced' : 'unsourced',
  };
}

/** One FieldView per key of `schemas/work.schema.json` → `properties`, in order. */
export function buildFieldViews(work: Work): FieldView[] {
  return WORK_FIELD_DESCRIPTORS.map((descriptor) => buildView(work, descriptor));
}

export function fieldViewsByGroup(work: Work): { id: string; label: string; fields: FieldView[] }[] {
  const views = buildFieldViews(work);
  return FIELD_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    fields: views.filter((v) => {
      const descriptor = WORK_FIELD_DESCRIPTORS.find((d) => d.name === v.field);
      return descriptor?.group === group.id;
    }),
  })).filter((group) => group.fields.length > 0);
}

/** Rows for a nested object (anime_details, official_zh_cn, …). */
export interface NestedRow {
  name: string;
  label: string;
  value: string;
  isUnknown: boolean;
  /** Present only for kind === "url"; never rendered as a link for unofficial_zh. */
  href: string | null;
  enumText: string | null;
}

export function nestedRows(
  nestedName: keyof typeof NESTED_FIELD_DESCRIPTORS | string,
  object: Record<string, unknown> | null | undefined,
  options: { links: boolean } = { links: true },
): NestedRow[] {
  const descriptors = NESTED_FIELD_DESCRIPTORS[nestedName] ?? [];
  return descriptors.map((descriptor) => {
    const raw = object ? object[descriptor.name] : undefined;
    const isUnknown = isBlank(raw);
    const formatted = formatByKind(descriptor.kind, raw);
    const enumText = descriptor.kind === 'enum' ? formatEnum(descriptor.name, raw) : null;
    return {
      name: descriptor.name,
      label: descriptor.label,
      value: enumText ?? formatted.value,
      isUnknown,
      href: options.links && descriptor.kind === 'url' && !isUnknown ? String(raw) : null,
      enumText,
    };
  });
}

/* -------------------------------------------------------------------------- *
 * Aggregates shown on the work page and the data-quality page
 * -------------------------------------------------------------------------- */

export interface ProvenanceSummary {
  total: number;
  unknown: number;
  sourced: number;
  unsourced: number;
  editorial: number;
  official: number;
  officialTag: number;
  derived: number;
  withConfidence: number;
  averageConfidence: number | null;
}

export function summarizeProvenance(views: FieldView[]): ProvenanceSummary {
  const confidences = views.map((v) => v.confidence).filter((c): c is number => typeof c === 'number');
  const count = (basis: FieldBasis) => views.filter((v) => v.basis === basis).length;
  return {
    total: views.length,
    unknown: views.filter((v) => v.state === 'unknown').length,
    sourced: views.filter((v) => v.state === 'sourced').length,
    unsourced: views.filter((v) => v.state === 'unsourced').length,
    editorial: count('editorial'),
    official: count('official'),
    officialTag: count('official_tag'),
    derived: count('derived'),
    withConfidence: confidences.length,
    averageConfidence:
      confidences.length === 0 ? null : confidences.reduce((a, b) => a + b, 0) / confidences.length,
  };
}

/**
 * Mean of the record's per-field confidence, or null when no field carries one.
 *
 * Uses the SAME view model as the detail page (`buildFieldViews`), so a field whose
 * confidence comes from `field_sources.confidence` rather than `field_confidence`
 * counts too. Keeping one definition avoids the list card and the detail page
 * disagreeing about the same record.
 *
 * This is a *field* confidence aggregate and must never be confused with the
 * rating aggregates, which are never averaged across scales (§5.2 P3).
 */
export function averageFieldConfidence(work: Work): number | null {
  return summarizeProvenance(buildFieldViews(work)).averageConfidence;
}
