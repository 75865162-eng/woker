import test from "node:test";
import assert from "node:assert/strict";
import React, { type ReactNode } from "react";
import { SellfoxBrowseFilters } from "@/components/sellfox/browse-filters";
import { defaultSellfoxView, type SellfoxView } from "@/lib/sellfox/workbench-view";

type Props = { children?: ReactNode; "aria-label"?: string; value?: string; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function elements(node: ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

test("Buy Box selects yes/no or all beside fulfillment and reset clears it only in supported domains", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const domain of ["sales", "performance", "listings"] as const) {
      for (const buyBox of ["", "yes", "no"] as const) {
        const patches: Partial<SellfoxView>[] = [];
        const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain, buyBox }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
        const selects = nodes.filter(node => node.type === "select");
        const select = selects.find(node => node.props["aria-label"] === "Buy Box")!;
        assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, buyBox);
        assert.equal(selects[selects.indexOf(select) - 1].props["aria-label"], "发货方式");
        const options = elements(select.props.children).filter(node => node.type === "option");
        assert.deepEqual(options.map(node => [node.props.value, node.props.children]), [["", "全部"], ["yes", "是"], ["no", "否"]]);
        for (const value of ["yes", "no", "", "true"]) {
          select.props.onChange!({ target: { value } });
          assert.deepEqual(patches.at(-1), { buyBox: value === "true" ? "" : value });
        }
        nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
        assert.equal(patches.at(-1)?.buyBox, "");
        assert.equal(patches.at(-1)?.fulfillment, "");
      }
    }
    for (const domain of ["overview", "stores", "inventory", "ads", "runs"] as const) {
      const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain, buyBox: "yes" }, stores: [], onChange: () => {}, onColumns: () => {} }));
      assert.equal(nodes.some(node => node.props["aria-label"] === "Buy Box"), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("product tag selects use dynamic distinct names, preserve URL selections, change and reset across all three domains", () => {
  // tsx uses the classic JSX transform for the repository's jsx:preserve setting.
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const domain of ["listings", "sales", "performance"] as const) {
      const patches: Partial<SellfoxView>[] = [];
      const tree = SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain, productTag: "URL专属标签" }, stores: [], productTags: ["新品", "标签、完整", "新品"], onChange: patch => patches.push(patch), onColumns: () => {} });
      const nodes = elements(tree);
      const select = nodes.find(node => node.type === "select" && node.props["aria-label"] === "产品标签")!;
      assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, "URL专属标签");
      assert.equal(nodes.some(node => node.props["aria-label"] === "产品标签（未同步）"), false);
      const options = elements(select.props.children).filter(node => node.type === "option");
      assert.deepEqual(options.map(node => node.props.value), ["", "URL专属标签", "新品", "标签、完整"]);
      select.props.onChange!({ target: { value: "标签、完整" } });
      assert.deepEqual(patches.at(-1), { productTag: "标签、完整" });
      nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
      assert.equal(patches.at(-1)?.productTag, "");
      assert.ok(nodes.some(node => node.props["aria-label"] === "业务员（未同步）") || domain === "listings");
    }
    const ads = SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "ads" }, stores: [], productTags: ["不解锁"], onChange: () => {}, onColumns: () => {} });
    assert.equal(elements(ads).some(node => node.type === "select" && node.props["aria-label"] === "产品标签"), false);
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("brand selects use dynamic distinct names, preserve URL selections, change and reset across all three domains", () => {
  // tsx uses the classic JSX transform for the repository's jsx:preserve setting.
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const domain of ["listings", "sales", "performance"] as const) {
      const patches: Partial<SellfoxView>[] = [];
      const tree = SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain, brand: "URL专属品牌" }, stores: [], brands: ["Nvaav", "Goghost-乐器", "Nvaav"], onChange: patch => patches.push(patch), onColumns: () => {} });
      const nodes = elements(tree);
      const select = nodes.find(node => node.type === "select" && node.props["aria-label"] === "品牌")!;
      assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, "URL专属品牌");
      assert.equal(nodes.some(node => node.props["aria-label"] === "品牌（未同步）"), false);
      const selects = nodes.filter(node => node.type === "select");
      assert.equal(selects[selects.indexOf(select) - 1].props["aria-label"], "产品标签");
      for (const label of ["配对状态（未同步）", "划线价类型（未同步）", "业务员（未同步）"]) {
        const locked = selects.find(node => node.props["aria-label"] === label);
        if (locked) assert.equal(locked.props.disabled, true);
      }
      const options = elements(select.props.children).filter(node => node.type === "option");
      assert.deepEqual(options.map(node => node.props.value), ["", ...["URL专属品牌", "Nvaav", "Goghost-乐器"].sort()]);
      select.props.onChange!({ target: { value: "  Goghost-乐器  " } });
      assert.deepEqual(patches.at(-1), { brand: "Goghost-乐器" });
      select.props.onChange!({ target: { value: "" } });
      assert.deepEqual(patches.at(-1), { brand: "" });
      nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
      assert.equal(patches.at(-1)?.brand, "");
      assert.ok(nodes.some(node => node.props["aria-label"] === "业务员（未同步）") || domain === "listings");
      const emptyNodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain }, stores: [], onChange: () => {}, onColumns: () => {} }));
      const emptySelect = emptyNodes.find(node => node.type === "select" && node.props["aria-label"] === "品牌")!;
      assert.equal(emptySelect.props.value, "");
      assert.deepEqual(elements(emptySelect.props.children).filter(node => node.type === "option").map(node => [node.props.value, node.props.children]), [["", "全部"]]);
    }
    const ads = SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "ads" }, stores: [], brands: ["不解锁"], onChange: () => {}, onColumns: () => {} });
    assert.equal(elements(ads).some(node => node.type === "select" && node.props["aria-label"] === "品牌"), false);
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});
