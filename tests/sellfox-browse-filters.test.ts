import test from "node:test";
import assert from "node:assert/strict";
import React, { type ReactNode } from "react";
import { SellfoxBrowseFilters } from "@/components/sellfox/browse-filters";
import { defaultSellfoxView, type SellfoxView } from "@/lib/sellfox/workbench-view";

type Props = { children?: ReactNode; "aria-label"?: string; title?: string; type?: string; value?: string; checked?: boolean; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function elements(node: ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

test("listings use enabled openDate range inputs and shortcuts, patch dates and reset; stores stay disabled", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "listings", from: "2024-01-15", to: "2024-02-20" }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
    assert.ok(nodes.some(node => node.type === "span" && node.props.children === "上架时间"));
    for (const [label, key, value] of [["开始日期", "from", "2024-01-15"], ["结束日期", "to", "2024-02-20"]] as const) {
      const input = nodes.find(node => node.type === "input" && node.props["aria-label"] === label)!;
      assert.equal(input.props.disabled, false);
      assert.equal(input.props.value, value);
      input.props.onChange!({ target: { value: "2024-02-01" } });
      assert.deepEqual(patches.at(-1), { [key]: "2024-02-01", allDates: false });
    }
    const shortcut = nodes.find(node => node.type === "select" && node.props["aria-label"] === "日期快捷")!;
    assert.ok(shortcut); assert.ok(!shortcut.props.disabled);
    assert.deepEqual(elements(shortcut.props.children).map(node => [node.props.value, node.props.children]), [["custom", "自定义"], ["0", "今天"], ["-1", "昨天"], ["-6", "近7天"], ["-29", "近30天"], ["all", "全部历史"]]);
    shortcut.props.onChange!({ target: { value: "all" } });
    assert.deepEqual(patches.at(-1), { from: "", to: "", allDates: true });
    nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
    assert.equal(patches.at(-1)?.from, "");
    assert.equal(patches.at(-1)?.to, "");
    assert.equal(patches.at(-1)?.allDates, false);
    const stores = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "stores" }, stores: [], onChange: () => {}, onColumns: () => {} }));
    for (const label of ["开始日期", "结束日期"]) assert.equal(stores.find(node => node.props["aria-label"] === label)!.props.disabled, true);
    assert.equal(stores.some(node => node.props["aria-label"] === "日期快捷"), false);
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("ads column picker defaults to image, rating, ratingCount and Buy Box across six tabs and respects explicit selections", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const) {
      for (const selectedColumns of [undefined, ["asin", "cost"], []]) {
        const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "ads", adsTab }, stores: [], selectedColumns, onChange: () => {}, onColumns: () => {} }));
        for (const name of ["图片", "星级", "评论数", "Buy Box"]) {
          const checkbox = nodes.find(node => node.props["aria-label"] === `显示${name}列`)!;
          assert.ok(checkbox);
          assert.equal(checkbox.props.checked, selectedColumns === undefined);
        }
        for (const name of ["MSKU", "标题", "店铺", "站点", "标签", "品牌", "发货方式"]) {
          assert.equal(nodes.find(node => node.props["aria-label"] === `显示${name}列`)!.props.checked, false);
        }
      }
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("ads fulfillment selects all/AFN/MFN across six tabs and resets without unlocking other filters", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const) {
      for (const fulfillment of ["", "AFN", "MFN"] as const) {
        const patches: Partial<SellfoxView>[] = [];
        const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "ads", adsTab, fulfillment }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
        const select = nodes.find(node => node.type === "select" && node.props["aria-label"] === "发货方式")!;
        assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, fulfillment);
        assert.deepEqual(elements(select.props.children).filter(node => node.type === "option").map(node => [node.props.value, node.props.children]), [["", "全部"], ["AFN", "AFN"], ["MFN", "MFN"]]);
        for (const value of ["AFN", "MFN", "", "afn", "未知"]) {
          select.props.onChange!({ target: { value } });
          assert.deepEqual(patches.at(-1), { fulfillment: value === "AFN" || value === "MFN" ? value : "" });
        }
        nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
        assert.equal(patches.at(-1)?.fulfillment, "");
        for (const label of ["运营状态", "服务状态", "广告策略"]) assert.ok(nodes.find(node => node.props["aria-label"] === `${label}（未同步）`)?.props.disabled);
        assert.equal(nodes.some(node => node.type === "select" && node.props["aria-label"] === "业务员"), false);
      }
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("Buy Box selects yes/no or all beside fulfillment and reset clears it only in supported domains", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const views: SellfoxView[] = [
      ...(["sales", "performance", "listings"] as const).map(domain => ({ ...defaultSellfoxView, domain })),
      ...(["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const).map(adsTab => ({ ...defaultSellfoxView, domain: "ads" as const, adsTab })),
    ];
    for (const view of views) {
      for (const buyBox of ["", "yes", "no"] as const) {
        const patches: Partial<SellfoxView>[] = [];
        const nodes = elements(SellfoxBrowseFilters({ view: { ...view, buyBox }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
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
    for (const domain of ["overview", "stores", "inventory", "runs"] as const) {
      const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain, buyBox: "yes" }, stores: [], onChange: () => {}, onColumns: () => {} }));
      assert.equal(nodes.some(node => node.props["aria-label"] === "Buy Box"), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("product tag selects use dynamic distinct names, preserve URL selections, change and reset across catalog domains and all six ads tabs", () => {
  // tsx uses the classic JSX transform for the repository's jsx:preserve setting.
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const views: SellfoxView[] = [
      ...(["listings", "sales", "performance"] as const).map(domain => ({ ...defaultSellfoxView, domain })),
      ...(["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const).map(adsTab => ({ ...defaultSellfoxView, domain: "ads" as const, adsTab })),
    ];
    for (const view of views) {
      const patches: Partial<SellfoxView>[] = [];
      const tree = SellfoxBrowseFilters({ view: { ...view, productTag: "URL专属标签" }, stores: [], productTags: ["新品", "标签、完整", "新品"], onChange: patch => patches.push(patch), onColumns: () => {} });
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
      assert.equal(nodes.some(node => node.props["aria-label"] === "业务员（未同步）"), view.domain === "sales");
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("brand selects use dynamic distinct names, preserve URL selections, change and reset across catalog domains and all six ads tabs", () => {
  // tsx uses the classic JSX transform for the repository's jsx:preserve setting.
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const views: SellfoxView[] = [
      ...(["listings", "sales", "performance"] as const).map(domain => ({ ...defaultSellfoxView, domain })),
      ...(["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const).map(adsTab => ({ ...defaultSellfoxView, domain: "ads" as const, adsTab })),
    ];
    for (const view of views) {
      const patches: Partial<SellfoxView>[] = [];
      const tree = SellfoxBrowseFilters({ view: { ...view, brand: "URL专属品牌" }, stores: [], brands: ["Nvaav", "Goghost-乐器", "Nvaav"], onChange: patch => patches.push(patch), onColumns: () => {} });
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
      select.props.onChange!({ target: { value: " 00123 " } });
      assert.deepEqual(patches.at(-1), { brand: "00123" });
      select.props.onChange!({ target: { value: "" } });
      assert.deepEqual(patches.at(-1), { brand: "" });
      nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
      assert.equal(patches.at(-1)?.brand, "");
      assert.equal(nodes.some(node => node.props["aria-label"] === "业务员（未同步）"), view.domain === "sales");
      const emptyNodes = elements(SellfoxBrowseFilters({ view, stores: [], onChange: () => {}, onColumns: () => {} }));
      const emptySelect = emptyNodes.find(node => node.type === "select" && node.props["aria-label"] === "品牌")!;
      assert.equal(emptySelect.props.value, "");
      assert.deepEqual(elements(emptySelect.props.children).filter(node => node.type === "option").map(node => [node.props.value, node.props.children]), [["", "全部"]]);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("ads tabs enable all six daily reports with distinct columns and explain deferred sources", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const) {
      const patches: Partial<SellfoxView>[] = [];
      const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "ads", adsTab }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
      for (const [label, tab] of [["广告产品", "product"], ["投放", "targeting"], ["搜索词", "searchTerm"], ["广告活动", "campaign"], ["广告组", "adGroup"], ["广告位", "placement"]] as const) {
        const button = nodes.find(node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === label)!;
        assert.ok(button); assert.equal(button.props.disabled, false); button.props.onClick!();
        assert.deepEqual(patches.at(-1), { adsTab: tab, searchType: "", page: 1 });
      }
      for (const label of ["广告组合", "否定", "AMC"]) {
        const button = nodes.find(node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === label)!;
        assert.ok(button); assert.equal(button.props.disabled, true);
        assert.ok((button.props as { title?: string }).title);
      }
      const logs = nodes.find(node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === "日志")!;
      assert.equal(logs.props.disabled, false);
      assert.match(logs.props.title!, /同步日志.*domain=runs.*非广告专属/);
      assert.deepEqual(logs.props.children, ["日志", null]);
      logs.props.onClick!();
      assert.deepEqual(patches.at(-1), { domain: "runs", page: 1 });
      const labels = nodes.filter(node => node.type === "input").map(node => node.props["aria-label"]);
      if (adsTab === "campaign") assert.ok(labels.includes("显示活动名称列"));
      if (adsTab === "adGroup") assert.ok(labels.includes("显示广告组名称列"));
      if (adsTab === "placement") assert.ok(labels.includes("显示广告位列"));
      assert.ok(nodes.some(node => node.type === "select" && node.props["aria-label"] === "产品标签" && !node.props.disabled));
      assert.ok(nodes.some(node => node.type === "select" && node.props["aria-label"] === "品牌" && !node.props.disabled));
      assert.ok(nodes.some(node => node.type === "select" && node.props["aria-label"] === "Buy Box" && !node.props.disabled));
      const search = nodes.find(node => node.type === "select" && node.props["aria-label"] === "搜索类型")!;
      const options = elements(search.props.children).map(node => node.props.value);
      assert.equal(options.includes("adGroupId"), adsTab !== "campaign");
      assert.equal(options.includes("placement"), adsTab === "placement");
      if (adsTab === "targeting") assert.ok(labels.includes("显示投放ID列"));
      if (adsTab === "searchTerm") assert.ok(labels.includes("显示用户搜索词列"));
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("listing pairing and strikethrough type stay disabled with specific evidence gaps", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "listings" }, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
    for (const [label, reason] of [["配对状态", /dxmPublishState.*DXM 发布状态.*尚无配对状态字段与稳定枚举/], ["划线价类型", /standardPrice.*listingPrice\/listingPricing.*枚举尚未验证/]] as const) {
      const select = nodes.find(node => node.type === "select" && node.props["aria-label"] === `${label}（未同步）`)!;
      assert.equal(select.props.disabled, true);
      const parent = nodes.find(node => node.type === "label" && elements(node.props.children).includes(select))!;
      assert.match(parent.props.title!, reason);
      assert.equal(select.props.onChange, undefined);
    }
    assert.deepEqual(patches, []);
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});


test("performance salesperson select uses facets/current value and resets; sales and dimension remain disabled", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const nodes = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "performance", salesperson: "URL姓名" }, stores: [], salespersons: ["陈馨", "温见清", "陈馨"], onChange: patch => patches.push(patch), onColumns: () => {} }));
    const select = nodes.find(n => n.type === "select" && n.props["aria-label"] === "业务员")!;
    assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, "URL姓名");
    assert.deepEqual(elements(select.props.children).filter(n => n.type === "option").map(n => n.props.value), ["", ...["URL姓名", "温见清", "陈馨"].sort()]);
    assert.ok(nodes.some(n => n.props.title?.includes("非 Listing developer/开发员")));
    assert.equal(nodes.some(n => n.props["aria-label"] === "业务员（未同步）"), false);
    select.props.onChange!({ target: { value: " 温见清 " } }); assert.deepEqual(patches.at(-1), { salesperson: "温见清" });
    nodes.find(n => n.type === "button" && n.props.children === "重置")!.props.onClick!(); assert.equal(patches.at(-1)?.salesperson, "");
    assert.ok(nodes.find(n => n.type === "button" && n.props.children === "业务员")?.props.disabled);
    assert.ok(nodes.some(n => n.props.title === "userNameList 为多人数组，无独立业务员主键，不做分组维度"));
    assert.ok(nodes.find(n => n.props["aria-label"] === "销售小组（未同步）")?.props.disabled);
    const sales = elements(SellfoxBrowseFilters({ view: { ...defaultSellfoxView, domain: "sales" }, stores: [], onChange: () => {}, onColumns: () => {} }));
    assert.ok(sales.find(n => n.props["aria-label"] === "业务员（未同步）")?.props.disabled);
    assert.ok(sales.some(n => n.props.title === "销量日快照无 userNameList；不从 Listing developer 伪造"));
    assert.equal(sales.some(n => n.props["aria-label"] === "业务员"), false);
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("listings DXM publish state select uses only facets plus URL value, changes and resets while pairing stays locked", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const view: SellfoxView = { ...defaultSellfoxView, domain: "listings", dxmPublishState: "URL-only" };
    const nodes = elements(SellfoxBrowseFilters({ view, stores: [], dxmPublishStates: ["delete", "raw-state", "delete"], onChange: patch => patches.push(patch), onColumns: () => {} }));
    const selects = nodes.filter(node => node.type === "select");
    const select = selects.find(node => node.props["aria-label"] === "DXM 发布状态")!;
    assert.ok(select); assert.ok(!select.props.disabled); assert.equal(select.props.value, "URL-only");
    assert.equal(selects[selects.indexOf(select) - 1].props["aria-label"], "Listing 状态");
    const parent = nodes.find(node => node.type === "label" && elements(node.props.children).includes(select))!;
    assert.match(parent.props.title!, /dxmPublishState.*精确匹配.*非配对状态.*NULL.*全部/);
    assert.deepEqual(elements(select.props.children).map(node => [node.props.value, node.props.children]), [["", "全部"], ...["URL-only", "delete", "raw-state"].sort().map(value => [value, value])]);
    for (const [value, expected] of [[" raw-state ", "raw-state"], [" 00123 ", "00123"], ["", ""]]) {
      select.props.onChange!({ target: { value } });
      assert.deepEqual(patches.at(-1), { dxmPublishState: expected });
    }
    nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
    assert.equal(patches.at(-1)?.dxmPublishState, "");
    for (const label of ["配对状态", "划线价类型"]) {
      const locked = selects.find(node => node.props["aria-label"] === `${label}（未同步）`)!;
      assert.equal(locked.props.disabled, true); assert.equal(locked.props.onChange, undefined);
    }
    const emptyNodes = elements(SellfoxBrowseFilters({ view: { ...view, dxmPublishState: "" }, stores: [], onChange: () => {}, onColumns: () => {} }));
    const emptySelect = emptyNodes.find(node => node.props["aria-label"] === "DXM 发布状态")!;
    assert.deepEqual(elements(emptySelect.props.children).map(node => [node.props.value, node.props.children]), [["", "全部"]]);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = elements(SellfoxBrowseFilters({ view: { ...view, domain }, stores: [], dxmPublishStates: ["delete"], onChange: () => {}, onColumns: () => {} }));
      assert.equal(other.some(node => node.props["aria-label"] === "DXM 发布状态"), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("listings show independent first-sale inputs and shortcuts, reset both ranges, and hide first-sale UI elsewhere", (t) => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T04:00:00Z") });
  try {
    const patches: Partial<SellfoxView>[] = [];
    const view: SellfoxView = { ...defaultSellfoxView, domain: "listings", from: "2023-01-01", to: "2023-12-31", firstSaleFrom: "2024-02-01", firstSaleTo: "2024-03-01" };
    const nodes = elements(SellfoxBrowseFilters({ view, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
    assert.ok(nodes.some(node => node.type === "span" && node.props.children === "上架时间"));
    const label = nodes.find(node => node.type === "span" && node.props.children === "首次售出")!;
    assert.match(label.props.title!, /firstSaleDate.*YYYY-MM-DD.*含首尾.*NULL/);
    for (const [aria, key] of [["首次售出开始", "firstSaleFrom"], ["首次售出结束", "firstSaleTo"]] as const) {
      const inputs = nodes.filter(node => node.type === "input" && node.props["aria-label"] === aria);
      assert.equal(inputs.length, 1); assert.ok(!inputs[0].props.disabled);
      assert.equal(inputs[0].props.value, view[key]);
      inputs[0].props.onChange!({ target: { value: "2024-02-15" } });
      assert.deepEqual(patches.at(-1), { [key]: "2024-02-15" });
    }
    for (const [aria, key] of [["开始日期", "from"], ["结束日期", "to"]] as const) {
      const inputs = nodes.filter(node => node.type === "input" && node.props["aria-label"] === aria);
      assert.equal(inputs.length, 1); assert.equal(inputs[0].props.value, view[key]);
      inputs[0].props.onChange!({ target: { value: "2023-02-01" } });
      assert.deepEqual(patches.at(-1), { [key]: "2023-02-01", allDates: false });
    }
    const shortcut = nodes.find(node => node.props["aria-label"] === "首次售出快捷")!;
    assert.deepEqual(elements(shortcut.props.children).map(node => node.props.children), ["自定义", "今天", "昨天", "近7天", "近30天", "全部历史"]);
    const count = patches.length;
    shortcut.props.onChange!({ target: { value: "custom" } }); assert.equal(patches.length, count);
    for (const [value, from, to] of [["0", "2026-10-27", "2026-10-27"], ["-1", "2026-10-26", "2026-10-26"], ["-6", "2026-10-21", "2026-10-27"], ["-29", "2026-09-28", "2026-10-27"], ["all", "", ""]]) {
      shortcut.props.onChange!({ target: { value } });
      assert.deepEqual(patches.at(-1), { firstSaleFrom: from, firstSaleTo: to });
    }
    nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
    for (const key of ["firstSaleFrom", "firstSaleTo", "from", "to"] as const) assert.equal(patches.at(-1)?.[key], "");
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = elements(SellfoxBrowseFilters({ view: { ...view, domain }, stores: [], onChange: () => {}, onColumns: () => {} }));
      for (const aria of ["首次售出开始", "首次售出结束", "首次售出快捷"]) assert.equal(other.some(node => node.props["aria-label"] === aria), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("listings show totalInventory min/max inputs, reset clears them, and hide elsewhere", (t) => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const view: SellfoxView = { ...defaultSellfoxView, domain: "listings", totalInventoryMin: "0", totalInventoryMax: "100" };
    const nodes = elements(SellfoxBrowseFilters({ view, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
    const label = nodes.find(node => node.type === "span" && node.props.children === "总库存")!;
    assert.match(label.props.title!, /totalInventory/); assert.match(label.props.title!, /不筛 AWD/);
    for (const [aria, key, next] of [["总库存下限", "totalInventoryMin", "10"], ["总库存上限", "totalInventoryMax", "50"]] as const) {
      const inputs = nodes.filter(node => node.type === "input" && node.props["aria-label"] === aria);
      assert.equal(inputs.length, 1); assert.equal(inputs[0].props.type, "number");
      assert.equal(inputs[0].props.value, view[key]);
      inputs[0].props.onChange!({ target: { value: next } });
      assert.deepEqual(patches.at(-1), { [key]: next });
    }
    nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
    for (const key of ["totalInventoryMin", "totalInventoryMax"] as const) assert.equal(patches.at(-1)?.[key], "");
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = elements(SellfoxBrowseFilters({ view: { ...view, domain }, stores: [], onChange: () => {}, onColumns: () => {} }));
      for (const aria of ["总库存下限", "总库存上限"]) assert.equal(other.some(node => node.props["aria-label"] === aria), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

test("ads show rating min/max inputs, reset clears them, and hide elsewhere", () => {
  const globals = globalThis as unknown as { React?: typeof React }, previous = globals.React;
  globals.React = React;
  try {
    const patches: Partial<SellfoxView>[] = [];
    const view: SellfoxView = { ...defaultSellfoxView, domain: "ads", ratingMin: "4", ratingMax: "5" };
    const nodes = elements(SellfoxBrowseFilters({ view, stores: [], onChange: patch => patches.push(patch), onColumns: () => {} }));
    const label = nodes.find(node => node.type === "span" && node.props.children === "星级")!;
    assert.match(label.props.title!, /ratingValue/); assert.match(label.props.title!, /汇总前筛选/);
    for (const [aria, key, next] of [["星级下限", "ratingMin", "3.5"], ["星级上限", "ratingMax", "4.8"]] as const) {
      const inputs = nodes.filter(node => node.type === "input" && node.props["aria-label"] === aria);
      assert.equal(inputs.length, 1); assert.equal(inputs[0].props.type, "number");
      assert.equal(inputs[0].props.value, view[key]);
      inputs[0].props.onChange!({ target: { value: next } });
      assert.deepEqual(patches.at(-1), { [key]: next });
    }
    nodes.find(node => node.type === "button" && node.props.children === "重置")!.props.onClick!();
    for (const key of ["ratingMin", "ratingMax"] as const) assert.equal(patches.at(-1)?.[key], "");
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = elements(SellfoxBrowseFilters({ view: { ...view, domain }, stores: [], onChange: () => {}, onColumns: () => {} }));
      for (const aria of ["星级下限", "星级上限"]) assert.equal(other.some(node => node.props["aria-label"] === aria), false);
    }
  } finally { if (previous === undefined) delete globals.React; else globals.React = previous; }
});

