import { Prisma } from "@prisma/client";

function productTagLabelsSql(payload: Prisma.Sql) {
  return Prisma.sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${payload}->'productLabelList')='array' THEN ${payload}->'productLabelList' ELSE '[]'::jsonb END) label_group(value)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(label_group.value->'labelDetailList')='array' THEN label_group.value->'labelDetailList' ELSE '[]'::jsonb END) label(value)`;
}

/** Exact names, independent of the display separator; malformed/missing lists are empty. */
export function sellfoxProductTagNamesSql(payload: Prisma.Sql) {
  return Prisma.sql`ARRAY(SELECT DISTINCT btrim(label.value->>'labelName')
    FROM ${productTagLabelsSql(payload)}
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL
    ORDER BY btrim(label.value->>'labelName'))`;
}

/** Stream normalized labels for workspace facets without building a per-Listing array. */
export function sellfoxProductTagRowsSql(payload: Prisma.Sql) {
  return Prisma.sql`SELECT btrim(label.value->>'labelName') AS "labelName"
    FROM ${productTagLabelsSql(payload)}
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL`;
}

export function sellfoxProductTagMatchSql(payload: Prisma.Sql, name: string) {
  return Prisma.sql`EXISTS (SELECT 1 FROM ${productTagLabelsSql(payload)}
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL
      AND btrim(label.value->>'labelName')=${name})`;
}

export function sellfoxProductTagDisplaySql(payload: Prisma.Sql) {
  return Prisma.sql`(SELECT string_agg(DISTINCT btrim(label.value->>'labelName'), '、' ORDER BY btrim(label.value->>'labelName'))
    FROM ${productTagLabelsSql(payload)}
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL)`;
}
