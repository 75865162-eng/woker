import type { ReactNode } from "react";

/**
 * 帮助文章的 Markdown 渲染。
 *
 * 只覆盖内容源实际用到的语法（## / ### 标题、段落、无序与有序列表、表格、加粗、行内代码），
 * 不引入完整 Markdown 依赖：帮助正文是静态文案，语法面很窄，自己解析比带一个解析器更可控。
 */
export function HelpProse({ markdown }: { markdown: string }) {
  return <div className="min-w-0">{renderBlocks(markdown)}</div>;
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const rows: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(lines[index].trim());
        index += 1;
      }
      const cells = rows.map(splitTableRow);
      const separator = cells[1]?.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, ""))) ?? false;
      const header = cells[0] ?? [];
      const body = separator ? cells.slice(2) : cells.slice(1);
      blocks.push({ type: "table", header, rows: body.filter((row) => row.length > 0) });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        if (ordered ? !/^\d+[.)]\s+/.test(candidate) : !/^[-*+]\s+/.test(candidate)) break;
        items.push(candidate.replace(ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (!candidate || candidate.startsWith("|") || /^#{1,4}\s+/.test(candidate)) break;
      if (/^[-*+]\s+/.test(candidate) || /^\d+[.)]\s+/.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("") });
  }

  return blocks;
}

function splitTableRow(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderBlocks(markdown: string): ReactNode[] {
  const blocks = parseBlocks(markdown);

  return blocks.map((block, blockIndex) => {
    const first = blockIndex === 0;

    if (block.type === "heading") {
      if (block.level <= 2) {
        return (
          <h3
            key={blockIndex}
            className={`text-body font-bold text-foreground ${first ? "" : "mt-7"} mb-2`}
          >
            {renderInline(block.text)}
          </h3>
        );
      }

      return (
        <h4
          key={blockIndex}
          className={`text-sm font-bold text-foreground ${first ? "" : "mt-5"} mb-1.5`}
        >
          {renderInline(block.text)}
        </h4>
      );
    }

    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          key={blockIndex}
          className={`${first ? "" : "mt-2"} ${block.ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 text-sm leading-7 text-foreground/85 marker:text-muted`}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
    }

    if (block.type === "table") {
      return (
        <div key={blockIndex} className={`${first ? "" : "mt-3"} overflow-x-auto rounded-lg border border-border`}>
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted">
                {block.header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-foreground"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-border/70 px-3 py-2 text-foreground/85 last:border-b-0"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <p key={blockIndex} className={`${first ? "" : "mt-2"} text-sm leading-7 text-foreground/85`}>
        {renderInline(block.text)}
      </p>
    );
  });
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${match.index}-strong`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-meta text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}
