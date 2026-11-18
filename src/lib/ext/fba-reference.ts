import source from './fba-reference-2026.json';

export type ReferenceBlock = { type: string; title?: string; note?: string; text?: string; head?: string[]; rows?: (string | number)[][]; foot?: string; events?: { date: string; title: string; items: string[] }[] };
export const referenceViews = source.views as { id: string; nav: string; title: string; lede?: string; blocks: ReferenceBlock[] }[];
export const referenceModel = 'US_FBA_2026_REFERENCE';
export const referenceSourceUrl = 'https://p9-flow-sign.byteimg.com/tos-cn-i-ik7evvg4ik/rc/pc/super_tool/69bc1c68fc864579b9975cee00445890.html?lk3s=8e244e95&rcl=20261112211249AFF3F19A1CD2EBF3DE3E&rrcfp=f512b60b&x-expires=1795785410&x-signature=oxUmWB%2FsbhkBJXOrfCZA6faIRSk%3D#/storage';
export const categoryRows = referenceViews.find(v => v.id === 'sales')!.blocks[0].rows!;
export const categories = categoryRows.map(row => String(row[0]));
const table = (view: string, title: string) => referenceViews.find(v => v.id === view)!.blocks.find(b => b.title === title)!.rows!;
export type ReferenceFee = { id: string; label: string; amount: string | null; unit: string; note: string };
export type ReferenceQuote = { sizeTier: string; weightLb: number; dimensionalWeightLb: number; cubicFeet: number; period: string; fees: ReferenceFee[]; warnings: string[] };
const rounded = (n: number) => n.toFixed(4);

/** Pure shared estimate: incomplete source rules stay null/ranges, never an invented zero. */
export function quoteReferenceFba(input: Record<string, unknown>, season?: 'offPeak' | 'peak'): ReferenceQuote {
  const number = (key: string, optional = false) => {
    const raw = input[key];
    if (optional && (raw === undefined || raw === '')) return null;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 0) throw new Error(`请填写有效的${key}（非负数）。`);
    return n;
  };
  const price = number('price')!, weight = number('weightLb')!;
  const dims = [number('lengthIn')!, number('widthIn')!, number('heightIn')!].sort((a,b) => b-a);
  if ([price, weight, ...dims].some(n => n <= 0)) throw new Error('售价、重量及三边必须大于 0。');
  const [a,b,c] = dims, girth = a + 2*(b+c), cubicFeet = a*b*c/1728, dim = a*b*c/139;
  const category = String(input.category ?? '');
  if (!categories.includes(category)) throw new Error('请选择商品品类。');
  const date = String(input.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('请选择有效测算日期。');
  const covered = date >= '2026-01-15' && date <= '2027-01-14';
  const peak = season ? season === 'peak' : date >= '2026-10-15' && date <= '2027-01-14';
  const month = Number(date.slice(5,7)), storagePeak = season ? season === 'peak' : month >= 10;
  const manualPeak = season ? season === 'peak' : month >= 11;
  const small = a<=15 && b<=12 && c<=0.75 && weight<=1;
  // Source size table exempts small standard and >150lb extra-large from dimensional weight.
  const w = small || weight>150 ? weight : Math.max(weight,dim);
  const tier = small ? 0 : a<=18 && b<=14 && c<=8 && w<=20 ? 1 : a<=37 && b<=28 && c<=20 && girth<=130 && w<=50 ? 2 : a<=59 && b<=33 && c<=33 && girth<=130 && w<=50 ? 3 : 4;
  const standard = tier<=1, apparel = category === '服装和配饰', shoes = category === '鞋靴';
  const oz = w*16, band = price<10 ? 0 : price<=50 ? 1 : 2, col = (peak?3:0)+band;
  const fees: ReferenceFee[] = [], warnings: string[] = [];
  const add = (id: string, label: string, amount: number | null, unit: string, note: string) => fees.push({id,label,amount: amount === null ? null : rounded(amount),unit,note});
  let shipping: number | null = null;
  const bulkyIndex = tier===2 ? 0 : tier===3 ? 1 : w<=50 ? 2 : w<=70 ? 3 : w<=150 ? 4 : 5;
  if (covered) {
    const rates = source.calc;
    if (standard) {
      const t = tier===0 ? rates.std_small : rates.std_large;
      const index = t.thresholds.findIndex(max => oz<=max+1e-9);
      if (index>=0) shipping = (apparel?t.apparel:t.normal)[index][col];
      else {
        const h = apparel?rates.heavy_apparel:rates.heavy_normal;
        shipping = h.base[col]+h.step[col]*Math.ceil(Math.max(0,w-3)/(apparel?0.5:0.25));
      }
    } else {
      const r = rates.bulky[bulkyIndex];
      shipping = r.base[col]+r.per_lb*Math.max(0,Math.ceil(w-r.from_lb));
    }
  }
  add('shipping','FBA 配送基础费',shipping,'USD / 发货件', `${peak?'旺季':'非旺季'}，售价${['<$10','$10–50','>$50'][band]}，含续重，不含以下附加项。`);
  const fuel = shipping===null ? null : date>='2026-04-17' ? shipping*0.035 : 0;
  add('fuel','燃油与物流附加费',fuel,'USD / 发货件','2026-04-17 起，配送基础费 × 3.5%。');
  add('delivery','基础配送＋燃油小计',shipping===null?null:shipping+(fuel??0),'USD / 发货件','普通商品基础配送与燃油费用，不含特大号处理费。');
  add('handling','特大号处理费',a>96||girth>130?null:0,'USD / 发货件',a>96||girth>130?'最长边 >96 in 或围长 >130 in，$17 起，精确档位待确认。':'未达到参考页特大号处理触发条件。');
  const revenue = price;
  const progressive = (cut: number, low: number, high: number) => Math.min(revenue,cut)*low+Math.max(0,revenue-cut)*high;
  let commission: number | null = revenue*0.15;
  if (apparel) commission=revenue*(revenue<=15?0.05:revenue<=20?0.10:0.17);
  else if (['母婴','美妆和个护健康'].includes(category)) commission=revenue*(revenue<=10?0.08:0.15);
  else if (category==='食品') commission=revenue*(revenue<=15?0.08:0.15);
  else if (category==='3D 打印机') commission=progressive(200,0.12,0.05);
  else if (category==='小型电器') commission=progressive(300,0.15,0.08);
  else if (category==='电子产品配件') commission=progressive(100,0.15,0.08);
  else if (category==='家具') commission=progressive(200,0.15,0.10);
  else if (category==='珠宝首饰') commission=progressive(250,0.20,0.05);
  else if (category==='钟表') commission=progressive(1500,0.16,0.03);
  else if (category==='割草机和除雪机') commission=revenue*(revenue<=500?0.15:0.08);
  else if (category==='艺术品') commission=null;
  else if (category==='宠物用品') commission=revenue*0.15;
  else {
    const rule = String(categoryRows.find(row=>row[0]===category)![1]);
    if (/^\d+%$/.test(rule)) commission=revenue*parseFloat(rule)/100;
  }
  const min = categoryRows.find(row=>row[0]===category)![2]==='$0.30'?0.3:0;
  if (commission!==null) commission=Math.max(min,commission);
  add('referral','销售佣金',commission,'USD / 成交件','按所选品类，基数仅为商品售价；艺术品分段措辞未明确累进规则时待确认。');
  add('refund','全额退款管理费',category.startsWith('媒介')?0:commission===null?null:Math.min(5,commission*0.2),'USD / 全额退款件','非媒介：佣金 × 20%，最高 $5；部分退款需按退款比例计算。');
  const weeks = number('utilizationWeeks',true), age = number('ageDays',true);
  const base = standard?(storagePeak?2.4:0.78):(storagePeak?1.4:0.56);
  const utilizationExempt=input.utilizationExempt==='true';
  const utilIndex = weeks===null?0:weeks<22?0:weeks<28?1:weeks<36?2:weeks<44?3:weeks<52?4:5;
  const util = utilizationExempt?0:weeks===null?null:([0,0.44,0.76,1.16,1.58,1.88].map((v,i)=>standard?v:[0,0.23,0.46,0.63,0.76,1.26][i]))[utilIndex];
  add('storageBase','基础月度仓储费',covered?cubicFeet*base:null,'USD / 库存件 / 月',`${storagePeak?'10–12 月':'1–9 月'}，${base} USD/ft³/月；按日均库存体积，展示持有一整月的单位成本。`);
  add('utilization','仓储利用率附加费',!covered||util===null?null:cubicFeet*util,'USD / 库存件 / 月','需输入利用率周数，或确认新卖家/个人卖家/日均 ≤25 ft³ 豁免。');
  let aged: number | null = age===null?null:0;
  if (age!==null && age>=181) {
    const idx = age<=210?0:age<=240?1:age<=270?2:age<=300?3:age<=330?4:age<=365?5:age<=455?6:7;
    const exemptCategory=apparel||shoes||['背包、手提包和箱包','珠宝首饰','钟表'].includes(category);
    // Source note says first six tiers exempt while table says tiers 4–6 apply. Do not choose silently.
    if (exemptCategory && idx>=3 && idx<=5) aged=null;
    else if (exemptCategory && idx<3) aged=0;
    else aged=Math.max(cubicFeet*[0.5,1,1.5,5.45,5.7,5.9,6.9,7.9][idx],idx===6?0.3:idx===7?0.35:0);
  }
  add('aged','超龄库存附加费',covered?aged:null,'USD / 库存件 / 月',age===null?'填写库龄后计算。':aged===null?'所选品类 271–365 天豁免：参考页总注与表内备注冲突，待确认。':'在月度仓储费外叠加；366 天起按体积与每件下限取较高值。');
  const d30=number('supply30',true),d90=number('supply90',true);
  const days=d30===null||d90===null?null:Math.max(d30,d90);
  const lowExempt=input.lowExempt==='true'||category==='食品';
  const lowRow=tier===0?0:tier===1?(w<=3?1:2):tier===2?3:tier===3?4:-1;
  const lowRates=[[0.89,0.63,0.32],[0.97,0.70,0.36],[1.11,0.87,0.47],[1.85,1.02,0.51],[2.09,1.15,0.57]];
  const any28=(d30!==null&&d30>=28)||(d90!==null&&d90>=28);
  const low = lowExempt||any28?0:days===null||lowRow<0?null:lowRates[lowRow][days<14?0:days<21?1:2];
  add('low','低库存水平费',covered?low:null,'USD / 发货件','30/90 天供货天数取较大值，任一 ≥28 天免收；超大件参考页未列。');
  let returnFee: number;
  if (tier===0) returnFee=(apparel||shoes?[1.65,1.75,1.85,1.95]:[1.78,1.84,1.90,1.96,2.02,2.08,2.14,2.21])[Math.min((apparel||shoes?3:7),Math.max(0,Math.ceil(oz/(apparel||shoes?4:2))-1))];
  else if (tier===1) {
    if (apparel||shoes) {
      const i=[4,8,12,16,24,32,40,48].findIndex(t=>oz<=t);
      returnFee=i>=0?[2.04,2.12,2.19,2.27,2.62,2.98,3.33,3.69][i]:3.89+0.10*Math.ceil((w-3)/0.5);
    } else {
      const i=[4,8,12,16,20,24,28,32,36,40,44,48].findIndex(t=>oz<=t);
      returnFee=i>=0?[2.36,2.7,3.05,3.39,3.7,4.01,4.32,4.63,4.66,4.68,4.71,4.73][i]:5+0.05*Math.ceil((w-3)/0.25);
    }
  } else if (tier<=3) returnFee=6.74+Math.max(0,Math.ceil(w-1))*0.32;
  else {
    const i=w<=50?0:w<=70?1:w<=150?2:3;
    returnFee=[26.33,40.12,52.45,157.35][i]+Math.max(0,Math.ceil(w-[1,51,71,151][i]))*[0.38,0.75,0.75,0.19][i];
  }
  add('return','退货处理费单价',covered?returnFee:null,'USD / 应收费退货件',apparel||shoes?'服装和鞋靴每件退货收费，无阈值豁免。':'仅超分类退货率阈值的部分收费，不等于每件退货均收。');
  const shipped=number('shippedUnits',true), returned=number('returnedUnits',true);
  if (shipped!==null&&!Number.isInteger(shipped)||returned!==null&&!Number.isInteger(returned)) throw new Error('配送与退货件数必须为整数。');
  if (shipped!==null&&returned!==null&&returned>shipped) throw new Error('退货件数不能超过配送件数。');
  const thresholdRows=table('sales','各分类退货率阈值');
  let threshold: number|null=null;
  for (const row of thresholdRows) for (const i of [0,2]) {
    const name=String(row[i]);
    if (name===category||category.startsWith('媒介')&&name.startsWith('媒介')||category.startsWith('其他')&&name==='其他') threshold=parseFloat(String(row[i+1]))/100;
  }
  const chargeable=returned===null?null:apparel||shoes?returned:shipped===null||threshold===null?null:Math.max(0,returned-shipped*threshold);
  add('returnTotal','退货处理费场景总额',covered&&chargeable!==null?chargeable*returnFee:null,'USD / 当月',threshold===null?'填写当月退货件数；未提供分类阈值时待确认。':`分类阈值 ${(threshold*100).toFixed(1)}%；填当月配送与退货件数，超阈值件数按差额估算，最终取整以账单为准。`);
  const awd=String(input.awdRegion??'');
  add('awdStorage','AWD 仓储费',awd==='west'?cubicFeet*0.57:awd==='east'?cubicFeet*0.48:null,'USD / 库存件 / 月','美西 $0.57/ft³，东部/南部 $0.48/ft³；未扣资格折扣。');
  add('awdTransport','AWD 补货运输费',cubicFeet*1.4,'USD / 补货件','AWD → FBA，$1.40/ft³；仅启用 AWD 时发生。');
  const removeStandard=standard;
  const removal=removeStandard?(w<=0.5?0.84:w<=1?1.53:w<=2?2.27:2.89+1.06*(w-2)):(w<=1?3.12:w<=2?4.3:w<=4?6.36:w<=10?10.04:14.32+1.06*(w-10));
  const liquidation=removeStandard?(w<=0.5?0.25:w<=1?0.3:w<=2?0.35:0.4+0.2*(w-2)):(w<=1?0.6:w<=2?0.7:w<=4?0.9:w<=10?1.45:1.9+0.2*(w-10));
  const reverseKnown=tier!==2;
  add('removal','移除订单费',covered&&reverseKnown?removal:null,'USD / 移除件',reverseKnown?'按重量段及超出首重部分计费。':'参考表仅列标准、大号大件/超大件与特殊处理，小号大件归类待确认。');
  add('disposal','弃置 / 销毁费',covered&&reverseKnown?removal:null,'USD / 弃置件','与移除订单同价；弃置和移除是替代场景，不叠加。');
  add('liquidation','批量清货处理费',covered&&reverseKnown?liquidation:null,'USD / 清货件','另加回收价值 15% 的清货佣金。');
  const recovery=number('recoveryValue',true);
  add('recovery','清货净回收',covered&&reverseKnown&&recovery!==null?recovery*0.85-liquidation:null,'USD / 清货件','回收价值 − 15% 清货佣金 − 清货处理费。');
  const split=String(input.split??'');
  const inboundTable=table('inbound',standard?'入库配置服务费 · 标准尺寸':'入库配置服务费 · 大件与超大件');
  const inboundIndex=tier===0?(oz<=8?0:1):tier===1?[0.75,1.5,3,5,7,10,15,20].findIndex(t=>w<=t)+2:[5,12,28,42,50].findIndex(t=>w<=t)+(tier===3?5:0);
  const range=split==='optimized'?'$0.00':tier===4||inboundIndex<0||split==='partial'&&standard?'待确认':String(inboundTable[inboundIndex]?.[split==='partial'?3:2]??'待确认');
  fees.push({id:'inbound',label:'入库配置服务费',amount:null,unit:'USD / 入库件',note:split?`${range}；优化拆分需满足 ≥5 个相同纸箱等条件，区间由目的运营中心决定。`:'选择入仓拆分方式查看费用区间。'});
  add('defect','入库缺陷处理费',input.defect==='true'?0.6:0,'USD / 缺陷件','参考页为平均 $0.60，非确定账单报价。');
  add('manual','人工处理费',input.manual==='true'?(manualPeak?0.3:0.15):0,'USD / 人工处理件','不符合预处理要求时；11–12 月 $0.30，其余 $0.15。');
  // All scenario amounts remain separate; there is deliberately no misleading grand total.
  if (!covered) warnings.push('参考费率适用 2026-01-15 至 2027-01-14；该日期超出覆盖范围，相关金额不计算。');
  if (small) warnings.push('小号标准按正文表使用商品重量；参考页内置演示统一取体积重，与正文不同。');
  if (weight>150) warnings.push('超大件 >150 lb 按正文表使用实际商品重量。');
  return {sizeTier:['小号标准尺寸','大号标准尺寸','小号大件','大号大件','超大件'][tier],weightLb:w,dimensionalWeightLb:dim,cubicFeet,period:peak?'旺季':'非旺季',fees,warnings};
}
