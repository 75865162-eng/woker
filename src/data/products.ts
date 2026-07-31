import type { Product, ProductStatus } from "@/lib/products/types";

export const productStatusLabels: Record<ProductStatus, string> = {
  pending: "待开发",
  developing: "开发中",
  ops_review: "运营确认中",
  design_in_progress: "美工处理中",
  listed: "已上架",
  canceled: "已取消",
  delisted: "已下架",
  patent_risk: "专利风险",
};

export const productStatusTones: Record<ProductStatus, "gray" | "blue" | "green" | "amber" | "red"> = {
  pending: "gray",
  developing: "blue",
  ops_review: "amber",
  design_in_progress: "blue",
  listed: "green",
  canceled: "red",
  delisted: "amber",
  patent_risk: "red",
};

export const productStatusOptions: { value: ProductStatus; label: string }[] = [
  { value: "pending", label: productStatusLabels.pending },
  { value: "developing", label: productStatusLabels.developing },
  { value: "ops_review", label: productStatusLabels.ops_review },
  { value: "design_in_progress", label: productStatusLabels.design_in_progress },
  { value: "listed", label: productStatusLabels.listed },
  { value: "canceled", label: productStatusLabels.canceled },
  { value: "delisted", label: productStatusLabels.delisted },
  { value: "patent_risk", label: productStatusLabels.patent_risk },
];

type ProductSeed = {
  chineseName: string;
  englishName: string;
  keywords: string;
  specs: string;
  hsCode: string;
  purchasePrice: number;
  productWeightG: number;
  productSizeCm: Product["productSizeCm"];
};

const productSeeds: ProductSeed[] = [
  { chineseName: "浓缩咖啡机镜子", englishName: "Espresso Shot Mirror", keywords: "espresso shot mirror,espresso mirror", specs: "普通磁铁 / 强磁;底座+引磁片", hsCode: "", purchasePrice: 6.5405, productWeightG: 100, productSizeCm: { length: 10, width: 10, height: 5 } },
  { chineseName: "硅胶杯垫套装", englishName: "Silicone Coaster Set", keywords: "coaster,silicone mat,table protector", specs: "6片装;黑白灰", hsCode: "3924100000", purchasePrice: 2.35, productWeightG: 180, productSizeCm: { length: 10, width: 10, height: 0.5 } },
  { chineseName: "抽屉分隔收纳盒", englishName: "Expandable Drawer Organizer", keywords: "drawer organizer,kitchen storage", specs: "白色;可伸缩", hsCode: "3924900000", purchasePrice: 8.9, productWeightG: 760, productSizeCm: { length: 38, width: 28, height: 6 } },
  { chineseName: "厨房硅胶油刷", englishName: "Silicone Basting Brush Set", keywords: "basting brush,bbq brush,kitchen tool", specs: "3支装;耐高温", hsCode: "3924100000", purchasePrice: 1.65, productWeightG: 120, productSizeCm: { length: 21, width: 3.5, height: 1.5 } },
  { chineseName: "不锈钢量勺套装", englishName: "Stainless Steel Measuring Spoons", keywords: "measuring spoon,baking tool,kitchen", specs: "6件套;银色", hsCode: "8215990000", purchasePrice: 3.2, productWeightG: 210, productSizeCm: { length: 16, width: 4, height: 3 } },
  { chineseName: "密封食品储物罐", englishName: "Airtight Food Storage Containers", keywords: "food container,pantry organizer,airtight jar", specs: "4件套;透明", hsCode: "3924100000", purchasePrice: 7.6, productWeightG: 880, productSizeCm: { length: 15, width: 10, height: 18 } },
  { chineseName: "冰箱磁吸调味罐", englishName: "Magnetic Spice Jars", keywords: "spice jar,magnetic container,kitchen organizer", specs: "12只装;带标签", hsCode: "7323930000", purchasePrice: 6.4, productWeightG: 620, productSizeCm: { length: 6, width: 6, height: 4.5 } },
  { chineseName: "可折叠洗菜篮", englishName: "Collapsible Colander Basket", keywords: "collapsible colander,strainer basket,kitchen sink", specs: "蓝灰色;可折叠", hsCode: "3924100000", purchasePrice: 3.95, productWeightG: 280, productSizeCm: { length: 31, width: 23, height: 9 } },
  { chineseName: "竹制餐具收纳盒", englishName: "Bamboo Cutlery Organizer", keywords: "cutlery tray,bamboo drawer organizer", specs: "5格;天然竹", hsCode: "4419190000", purchasePrice: 6.9, productWeightG: 720, productSizeCm: { length: 34, width: 25, height: 5 } },
  { chineseName: "水槽防溅挡板", englishName: "Sink Splash Guard", keywords: "sink splash guard,kitchen faucet mat", specs: "硅胶;灰色", hsCode: "3924900000", purchasePrice: 2.75, productWeightG: 190, productSizeCm: { length: 37, width: 14, height: 0.8 } },
  { chineseName: "浴室免打孔置物架", englishName: "Adhesive Shower Shelf", keywords: "shower shelf,bathroom organizer,no drill", specs: "黑色;双层", hsCode: "7324900000", purchasePrice: 7.2, productWeightG: 690, productSizeCm: { length: 32, width: 12, height: 8 } },
  { chineseName: "吸水速干地垫", englishName: "Quick Dry Bath Mat", keywords: "bath mat,quick dry rug,bathroom floor", specs: "40*60cm;灰色", hsCode: "5705002000", purchasePrice: 4.35, productWeightG: 520, productSizeCm: { length: 60, width: 40, height: 0.7 } },
  { chineseName: "马桶清洁刷套装", englishName: "Toilet Brush and Holder Set", keywords: "toilet brush,bathroom cleaning,holder", specs: "白色;壁挂", hsCode: "9603909090", purchasePrice: 3.85, productWeightG: 410, productSizeCm: { length: 41, width: 10, height: 10 } },
  { chineseName: "旅行分装瓶套装", englishName: "Travel Bottles Set", keywords: "travel bottles,toiletry container,tsa approved", specs: "8件套;透明袋", hsCode: "3923300000", purchasePrice: 2.25, productWeightG: 160, productSizeCm: { length: 17, width: 13, height: 4 } },
  { chineseName: "化妆刷收纳筒", englishName: "Makeup Brush Holder", keywords: "makeup organizer,brush holder,vanity storage", specs: "透明亚克力;3格", hsCode: "3926909090", purchasePrice: 3.1, productWeightG: 250, productSizeCm: { length: 18, width: 8, height: 10 } },
  { chineseName: "首饰旅行收纳盒", englishName: "Travel Jewelry Organizer Box", keywords: "jewelry box,travel organizer,earring storage", specs: "粉色;便携", hsCode: "4202920000", purchasePrice: 4.7, productWeightG: 220, productSizeCm: { length: 16, width: 11, height: 5 } },
  { chineseName: "衣柜分层收纳架", englishName: "Closet Shelf Divider", keywords: "closet organizer,shelf divider,wardrobe storage", specs: "4只装;白色", hsCode: "3924900000", purchasePrice: 5.45, productWeightG: 540, productSizeCm: { length: 30, width: 28, height: 18 } },
  { chineseName: "透明鞋盒收纳箱", englishName: "Clear Shoe Storage Boxes", keywords: "shoe box,clear storage,stackable organizer", specs: "6只装;透明", hsCode: "3923100000", purchasePrice: 12.8, productWeightG: 1850, productSizeCm: { length: 34, width: 23, height: 14 } },
  { chineseName: "床底收纳袋", englishName: "Under Bed Storage Bag", keywords: "under bed storage,clothes organizer,blanket bag", specs: "2只装;灰色", hsCode: "6307909000", purchasePrice: 6.1, productWeightG: 650, productSizeCm: { length: 100, width: 45, height: 15 } },
  { chineseName: "真空压缩袋套装", englishName: "Vacuum Storage Bags", keywords: "vacuum storage bag,space saver,clothes bag", specs: "10件套;含手泵", hsCode: "3923210000", purchasePrice: 7.95, productWeightG: 780, productSizeCm: { length: 70, width: 50, height: 0.2 } },
  { chineseName: "桌面文件收纳盘", englishName: "Desktop File Organizer Tray", keywords: "file tray,desk organizer,office storage", specs: "三层;黑色金属", hsCode: "7326909000", purchasePrice: 8.3, productWeightG: 980, productSizeCm: { length: 33, width: 24, height: 18 } },
  { chineseName: "人体工学鼠标垫", englishName: "Ergonomic Mouse Pad with Wrist Rest", keywords: "mouse pad,wrist rest,office accessory", specs: "黑色;凝胶腕托", hsCode: "4016999090", purchasePrice: 2.9, productWeightG: 260, productSizeCm: { length: 25, width: 22, height: 2 } },
  { chineseName: "笔记本电脑支架", englishName: "Adjustable Laptop Stand", keywords: "laptop stand,desk riser,aluminum holder", specs: "铝合金;可折叠", hsCode: "7616999000", purchasePrice: 9.6, productWeightG: 720, productSizeCm: { length: 26, width: 21, height: 5 } },
  { chineseName: "手机直播支架", englishName: "Phone Tripod Stand", keywords: "phone tripod,live stream stand,selfie holder", specs: "160cm;带蓝牙遥控", hsCode: "9620000000", purchasePrice: 6.85, productWeightG: 580, productSizeCm: { length: 45, width: 7, height: 7 } },
  { chineseName: "磁吸手机车载支架", englishName: "Magnetic Car Phone Mount", keywords: "car phone mount,magnetic holder,dashboard", specs: "黑色;强磁", hsCode: "3926909090", purchasePrice: 3.55, productWeightG: 130, productSizeCm: { length: 6, width: 4, height: 4 } },
  { chineseName: "USB-C 数据线套装", englishName: "USB C Cable Set", keywords: "usb c cable,charging cord,fast charge", specs: "3条装;1m/2m/3m", hsCode: "8544421100", purchasePrice: 4.25, productWeightG: 210, productSizeCm: { length: 300, width: 1, height: 0.5 } },
  { chineseName: "桌面充电线固定夹", englishName: "Cable Clips for Desk", keywords: "cable clips,cord organizer,desk accessory", specs: "20只装;黑白", hsCode: "3926909090", purchasePrice: 1.45, productWeightG: 80, productSizeCm: { length: 3, width: 1.5, height: 1.2 } },
  { chineseName: "宠物慢食碗", englishName: "Slow Feeder Dog Bowl", keywords: "slow feeder bowl,dog bowl,pet feeding", specs: "中号;蓝色", hsCode: "3924900000", purchasePrice: 3.75, productWeightG: 310, productSizeCm: { length: 20, width: 20, height: 4.5 } },
  { chineseName: "宠物毛发清洁刷", englishName: "Pet Hair Remover Brush", keywords: "pet hair remover,lint brush,dog cat hair", specs: "双面;可清洗", hsCode: "9603909090", purchasePrice: 2.85, productWeightG: 180, productSizeCm: { length: 19, width: 7, height: 4 } },
  { chineseName: "猫砂铲收纳套装", englishName: "Cat Litter Scoop Holder Set", keywords: "cat litter scoop,pet cleaning,holder", specs: "灰色;带底座", hsCode: "3924900000", purchasePrice: 3.3, productWeightG: 260, productSizeCm: { length: 28, width: 12, height: 8 } },
  { chineseName: "狗狗训练响片", englishName: "Dog Training Clickers", keywords: "dog clicker,pet training,puppy trainer", specs: "6只装;带腕绳", hsCode: "3926909090", purchasePrice: 1.75, productWeightG: 90, productSizeCm: { length: 6, width: 4, height: 2 } },
  { chineseName: "便携宠物饮水瓶", englishName: "Portable Dog Water Bottle", keywords: "dog water bottle,pet travel,bowl bottle", specs: "550ml;蓝色", hsCode: "3923300000", purchasePrice: 4.6, productWeightG: 230, productSizeCm: { length: 26, width: 8, height: 8 } },
  { chineseName: "瑜伽拉力带套装", englishName: "Resistance Bands Set", keywords: "resistance bands,yoga bands,workout set", specs: "5条装;不同阻力", hsCode: "9506911900", purchasePrice: 3.8, productWeightG: 250, productSizeCm: { length: 30, width: 5, height: 0.5 } },
  { chineseName: "运动水壶", englishName: "Motivational Sports Water Bottle", keywords: "water bottle,sports bottle,fitness", specs: "1L;带刻度", hsCode: "3923300000", purchasePrice: 3.95, productWeightG: 210, productSizeCm: { length: 28, width: 8, height: 8 } },
  { chineseName: "跳绳计数器", englishName: "Jump Rope with Counter", keywords: "jump rope,counter skipping rope,fitness", specs: "黑色;机械计数", hsCode: "9506911900", purchasePrice: 2.65, productWeightG: 190, productSizeCm: { length: 300, width: 3, height: 3 } },
  { chineseName: "自行车手机包", englishName: "Bike Phone Frame Bag", keywords: "bike phone bag,bicycle pouch,cycling gear", specs: "防水;触屏窗", hsCode: "4202920000", purchasePrice: 5.9, productWeightG: 260, productSizeCm: { length: 20, width: 10, height: 9 } },
  { chineseName: "户外折叠坐垫", englishName: "Foldable Camping Seat Pad", keywords: "camping pad,foldable seat,outdoor cushion", specs: "2片装;防潮", hsCode: "3926909090", purchasePrice: 2.2, productWeightG: 120, productSizeCm: { length: 38, width: 28, height: 1 } },
  { chineseName: "露营餐具收纳袋", englishName: "Camping Utensil Organizer Bag", keywords: "camping utensil bag,outdoor kitchen,travel pouch", specs: "黑色;多隔层", hsCode: "4202920000", purchasePrice: 6.35, productWeightG: 410, productSizeCm: { length: 36, width: 22, height: 5 } },
  { chineseName: "园艺手套带爪", englishName: "Garden Gloves with Claws", keywords: "garden gloves,digging gloves,planting tool", specs: "1双;绿色", hsCode: "6116100000", purchasePrice: 2.15, productWeightG: 140, productSizeCm: { length: 24, width: 13, height: 3 } },
  { chineseName: "植物标签牌", englishName: "Plastic Plant Labels", keywords: "plant labels,garden marker,seed tags", specs: "100片装;白色", hsCode: "3926909090", purchasePrice: 1.35, productWeightG: 110, productSizeCm: { length: 10, width: 2, height: 0.2 } },
  { chineseName: "儿童餐垫", englishName: "Silicone Baby Placemat", keywords: "baby placemat,silicone mat,kids dining", specs: "防滑;卡通款", hsCode: "3924100000", purchasePrice: 2.95, productWeightG: 220, productSizeCm: { length: 40, width: 30, height: 0.4 } },
  { chineseName: "婴儿推车挂钩", englishName: "Stroller Hooks", keywords: "stroller hook,baby accessory,bag hanger", specs: "2只装;魔术贴", hsCode: "3926909090", purchasePrice: 1.8, productWeightG: 95, productSizeCm: { length: 16, width: 5, height: 2 } },
  { chineseName: "儿童防撞角", englishName: "Baby Corner Protectors", keywords: "corner protector,baby safety,edge guard", specs: "24只装;透明", hsCode: "3926909090", purchasePrice: 2.4, productWeightG: 150, productSizeCm: { length: 3, width: 3, height: 2 } },
  { chineseName: "汽车后备箱收纳箱", englishName: "Car Trunk Organizer", keywords: "trunk organizer,car storage,collapsible box", specs: "可折叠;黑色", hsCode: "4202920000", purchasePrice: 8.75, productWeightG: 980, productSizeCm: { length: 55, width: 32, height: 28 } },
  { chineseName: "车载垃圾桶", englishName: "Car Trash Can with Lid", keywords: "car trash can,auto organizer,mini bin", specs: "2L;带盖", hsCode: "3924900000", purchasePrice: 3.45, productWeightG: 240, productSizeCm: { length: 18, width: 12, height: 20 } },
  { chineseName: "汽车座椅缝隙塞", englishName: "Car Seat Gap Filler", keywords: "seat gap filler,car organizer,auto accessory", specs: "2只装;黑色皮革", hsCode: "3926909090", purchasePrice: 4.15, productWeightG: 260, productSizeCm: { length: 42, width: 7, height: 4 } },
  { chineseName: "LED 橱柜感应灯", englishName: "LED Motion Sensor Cabinet Light", keywords: "cabinet light,motion sensor led,closet light", specs: "2只装;USB充电", hsCode: "9405429000", purchasePrice: 6.95, productWeightG: 310, productSizeCm: { length: 30, width: 4, height: 1.2 } },
  { chineseName: "太阳能庭院灯", englishName: "Solar Garden Lights", keywords: "solar lights,pathway light,garden decor", specs: "8只装;暖白光", hsCode: "9405410000", purchasePrice: 9.9, productWeightG: 920, productSizeCm: { length: 36, width: 6, height: 6 } },
  { chineseName: "可调节书立", englishName: "Adjustable Bookends", keywords: "bookends,desk book holder,office organizer", specs: "金属;白色", hsCode: "7326909000", purchasePrice: 4.85, productWeightG: 560, productSizeCm: { length: 15, width: 12, height: 20 } },
  { chineseName: "礼品包装纸收纳袋", englishName: "Wrapping Paper Storage Bag", keywords: "wrapping paper storage,gift wrap organizer", specs: "长款;防尘", hsCode: "6307909000", purchasePrice: 5.25, productWeightG: 360, productSizeCm: { length: 102, width: 35, height: 12 } },
];

const developers = ["陈林", "王悦", "李舟", "赵敏", "周航", "刘琪", "孙扬", "何安"];
const suppliers = ["义乌尚品家居", "宁波优选塑业", "深圳新迈电子", "曹县木盛坊木制品厂", "广州万合日用品", "东莞启诚五金", "厦门蓝鲸户外", "杭州小鹿母婴"];
const statuses: ProductStatus[] = ["pending", "developing", "ops_review", "listed", "canceled", "delisted", "patent_risk"];
const leadTimes = ["3天", "5天", "7天", "10天", "12天", "15天"];

export const initialProducts: Product[] = productSeeds.map((seed, index) => {
  const sku = String(index + 1).padStart(5, "0");
  const packageSizeCm = {
    length: Number((seed.productSizeCm.length + 2).toFixed(1)),
    width: Number((seed.productSizeCm.width + 2).toFixed(1)),
    height: Number((seed.productSizeCm.height + 2).toFixed(1)),
  };

  return {
    id: `prod-${sku}`,
    sku,
    chineseName: seed.chineseName,
    englishName: seed.englishName,
    asin: index === 0 ? "" : index % 4 === 1 ? "" : `B0${String(10000000 + index * 7391).slice(0, 8)}`,
    developer: index === 0 ? "黄斯涵" : developers[index % developers.length],
    purchasePrice: seed.purchasePrice,
    status: index === 0 ? "developing" : statuses[index % statuses.length],
    supplierName: index === 0 ? "深圳泰沃数码科技有限公司" : suppliers[index % suppliers.length],
    supplierUrl: index === 0 ? "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0" : `https://example.com/supplier/${sku}`,
    specs: seed.specs,
    purchaseLeadTime: index === 0 ? "" : leadTimes[index % leadTimes.length],
    createdAt: index === 0 ? "2026-07-23 20:37:13" : `2026-${String(6 + Math.floor(index / 30)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")} 00:00:00`,
    keywords: seed.keywords,
    note: index === 0 ? "咖啡爱好者 / 咖啡师用于观察咖啡液流出形态；重点改进强磁底座、3M背胶引磁片、飞机盒和说明书。" : index % 5 === 4 ? "注意检查外观专利与关键词合规。" : "演示数据，可在详情页继续补充采购和上架信息。",
    cancelReason: statuses[index % statuses.length] === "canceled" ? "演示数据：供应商报价或合规风险不符合继续开发要求。" : "",
    hsCode: seed.hsCode,
    images: [],
    competitorAsins: index === 0 ? ["B0D2WNHF3V", "B0BJP1FM72", "B0DM1TB116", "B0F9Y1C7MZ", "B0GVDVJDVH", "B0BXCLX3HC"] : [`B0${String(20000000 + index * 5179).slice(0, 8)}`, `B0${String(30000000 + index * 6833).slice(0, 8)}`],
    productWeightG: seed.productWeightG,
    packageWeightG: index === 0 ? 108.86 : seed.productWeightG + 90 + (index % 6) * 25,
    productSizeCm: seed.productSizeCm,
    packageSizeCm: index === 0 ? { length: 9.14, width: 9.14, height: 5.33 } : packageSizeCm,
  };
});
