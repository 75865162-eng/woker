import { helpArticleBodies } from "./articles";
import { helpArticles, type HelpArticleMeta, type HelpCategoryId } from "./catalog";

/**
 * 帮助中心的站内搜索。
 *
 * 打分规则沿用内容源的搜索口径：标题命中权重最高，别名命中次之，正文命中只做兜底，
 * 这样「ACOS 查不到」「AWD」这类口语化关键词能直接落到对应文章。
 * 每个中文词再拆成二元组做补充命中，避免长句整串比对不上的问题。
 */

export type HelpSearchItem = {
  article: HelpArticleMeta;
  title: string;
  summary: string;
  body: string;
  aliases: string[];
};

const STOP_WORDS = new Set([
  "怎么", "什么", "如何", "为什", "么办", "可以", "能不", "不能", "是不", "是否", "有没",
  "那些", "哪些", "这个", "那个", "我的", "你的", "就是", "还是", "需要", "为什",
]);

export function normalizeHelpText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function buildHelpSearchIndex(category?: HelpCategoryId): HelpSearchItem[] {
  return helpArticles
    .filter((article) => !category || article.category === category)
    .map((article) => ({
      article,
      title: normalizeHelpText(article.title),
      summary: normalizeHelpText(article.summary),
      body: normalizeHelpText(helpArticleBodies[article.id] ?? ""),
      aliases: article.aliases.map(normalizeHelpText).filter(Boolean),
    }));
}

function tokenize(raw: string): string[] {
  const tokens: string[] = raw.normalize("NFKC").toLowerCase().match(/[a-z0-9+]+/g) ?? [];
  for (const run of raw.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!STOP_WORDS.has(bigram)) tokens.push(bigram);
    }
  }
  return [...new Set(tokens)];
}

/** 编辑距离（含相邻换位），用于别名近似匹配。 */
function editDistance(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let row = 0; row <= left.length; row += 1) distances[row][0] = row;
  for (let column = 0; column <= right.length; column += 1) distances[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distances[row][column] = Math.min(distances[row][column], distances[row - 2][column - 2] + 1);
      }
    }
  }
  return distances[left.length][right.length];
}

export type HelpSearchResult = {
  item: HelpSearchItem;
  score: number;
  approximate: boolean;
};

export function searchHelpArticles(index: HelpSearchItem[], query: string): HelpSearchResult[] {
  const trimmed = query.slice(0, 200);
  const normalized = normalizeHelpText(trimmed);
  const tokens = tokenize(trimmed);

  if (!normalized) {
    return index.map((item) => ({ item, score: 1, approximate: false }));
  }

  const results: HelpSearchResult[] = [];

  for (const item of index) {
    let score = item.title.includes(normalized) ? 70 : 0;
    let approximate = false;

    for (const alias of item.aliases) {
      if (alias === normalized) score += 95;
      else if (alias.length > 1 && normalized.includes(alias)) score += /^[a-z0-9+]+$/.test(alias) ? 44 : 14;
      else if (normalized.length > 1 && alias.includes(normalized)) score += 24;

      if (normalized.length >= 3 && normalized.length <= 18 && alias.length >= 3 && alias !== normalized) {
        const tolerance = normalized.length >= 8 ? 2 : 1;
        if (Math.abs(normalized.length - alias.length) <= tolerance) {
          const distance = editDistance(normalized, alias);
          if (distance > 0 && distance <= tolerance && 1 - distance / Math.max(normalized.length, alias.length) >= 0.7) {
            score += 36 - distance * 8;
            approximate = true;
          }
        }
      }
    }

    for (const token of tokens) {
      if (item.title.includes(token)) score += 5;
      else if (item.aliases.some((alias) => alias.includes(token))) score += 4;
      else if (item.summary.includes(token)) score += 2;
      // 正文命中给到 3：单字/单词查询也能命中正文里提到该功能的文章，不至于只返回标题党那一条。
      else if (item.body.includes(token)) score += 3;
    }

    if (score > 2) results.push({ item, score, approximate });
  }

  return results.sort(
    (left, right) => right.score - left.score || left.item.article.order - right.item.article.order,
  );
}
