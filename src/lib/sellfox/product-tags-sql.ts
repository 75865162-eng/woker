import { Prisma } from "@prisma/client";

/** Exact names, independent of the display separator; malformed/missing lists are empty. */
export function sellfoxProductTagNamesSql(payload: Prisma.Sql) {
  return Prisma.sql`ARRAY(SELECT DISTINCT btrim(label.value->>'labelName')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${payload}->'productLabelList')='array' THEN ${payload}->'productLabelList' ELSE '[]'::jsonb END) label_group(value)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(label_group.value->'labelDetailList')='array' THEN label_group.value->'labelDetailList' ELSE '[]'::jsonb END) label(value)
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL
    ORDER BY btrim(label.value->>'labelName'))`;
}
