import type { Product, ProductStatus } from "@/lib/products/types";

export const productStatusLabels: Record<ProductStatus, string> = {
  listing_confirming: "确认上架",
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
  listing_confirming: "amber",
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
  { value: "listing_confirming", label: productStatusLabels.listing_confirming },
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
  { chineseName: "娴撶缉鍜栧暋鏈洪暅瀛?, englishName: "Espresso Shot Mirror", keywords: "espresso shot mirror,espresso mirror", specs: "鏅€氱閾?/ 寮虹;搴曞骇+寮曠鐗?, hsCode: "", purchasePrice: 6.5405, productWeightG: 100, productSizeCm: { length: 10, width: 10, height: 5 } },
  { chineseName: "纭呰兌鏉灚濂楄", englishName: "Silicone Coaster Set", keywords: "coaster,silicone mat,table protector", specs: "6鐗囪;榛戠櫧鐏?, hsCode: "3924100000", purchasePrice: 2.35, productWeightG: 180, productSizeCm: { length: 10, width: 10, height: 0.5 } },
  { chineseName: "鎶藉眽鍒嗛殧鏀剁撼鐩?, englishName: "Expandable Drawer Organizer", keywords: "drawer organizer,kitchen storage", specs: "鐧借壊;鍙几缂?, hsCode: "3924900000", purchasePrice: 8.9, productWeightG: 760, productSizeCm: { length: 38, width: 28, height: 6 } },
  { chineseName: "鍘ㄦ埧纭呰兌娌瑰埛", englishName: "Silicone Basting Brush Set", keywords: "basting brush,bbq brush,kitchen tool", specs: "3鏀;鑰愰珮娓?, hsCode: "3924100000", purchasePrice: 1.65, productWeightG: 120, productSizeCm: { length: 21, width: 3.5, height: 1.5 } },
  { chineseName: "涓嶉攬閽㈤噺鍕哄瑁?, englishName: "Stainless Steel Measuring Spoons", keywords: "measuring spoon,baking tool,kitchen", specs: "6浠跺;閾惰壊", hsCode: "8215990000", purchasePrice: 3.2, productWeightG: 210, productSizeCm: { length: 16, width: 4, height: 3 } },
  { chineseName: "瀵嗗皝椋熷搧鍌ㄧ墿缃?, englishName: "Airtight Food Storage Containers", keywords: "food container,pantry organizer,airtight jar", specs: "4浠跺;閫忔槑", hsCode: "3924100000", purchasePrice: 7.6, productWeightG: 880, productSizeCm: { length: 15, width: 10, height: 18 } },
  { chineseName: "鍐扮纾佸惛璋冨懗缃?, englishName: "Magnetic Spice Jars", keywords: "spice jar,magnetic container,kitchen organizer", specs: "12鍙;甯︽爣绛?, hsCode: "7323930000", purchasePrice: 6.4, productWeightG: 620, productSizeCm: { length: 6, width: 6, height: 4.5 } },
  { chineseName: "鍙姌鍙犳礂鑿滅", englishName: "Collapsible Colander Basket", keywords: "collapsible colander,strainer basket,kitchen sink", specs: "钃濈伆鑹?鍙姌鍙?, hsCode: "3924100000", purchasePrice: 3.95, productWeightG: 280, productSizeCm: { length: 31, width: 23, height: 9 } },
  { chineseName: "绔瑰埗椁愬叿鏀剁撼鐩?, englishName: "Bamboo Cutlery Organizer", keywords: "cutlery tray,bamboo drawer organizer", specs: "5鏍?澶╃劧绔?, hsCode: "4419190000", purchasePrice: 6.9, productWeightG: 720, productSizeCm: { length: 34, width: 25, height: 5 } },
  { chineseName: "姘存Ы闃叉簠鎸℃澘", englishName: "Sink Splash Guard", keywords: "sink splash guard,kitchen faucet mat", specs: "纭呰兌;鐏拌壊", hsCode: "3924900000", purchasePrice: 2.75, productWeightG: 190, productSizeCm: { length: 37, width: 14, height: 0.8 } },
  { chineseName: "娴村鍏嶆墦瀛旂疆鐗╂灦", englishName: "Adhesive Shower Shelf", keywords: "shower shelf,bathroom organizer,no drill", specs: "榛戣壊;鍙屽眰", hsCode: "7324900000", purchasePrice: 7.2, productWeightG: 690, productSizeCm: { length: 32, width: 12, height: 8 } },
  { chineseName: "鍚告按閫熷共鍦板灚", englishName: "Quick Dry Bath Mat", keywords: "bath mat,quick dry rug,bathroom floor", specs: "40*60cm;鐏拌壊", hsCode: "5705002000", purchasePrice: 4.35, productWeightG: 520, productSizeCm: { length: 60, width: 40, height: 0.7 } },
  { chineseName: "椹《娓呮磥鍒峰瑁?, englishName: "Toilet Brush and Holder Set", keywords: "toilet brush,bathroom cleaning,holder", specs: "鐧借壊;澹佹寕", hsCode: "9603909090", purchasePrice: 3.85, productWeightG: 410, productSizeCm: { length: 41, width: 10, height: 10 } },
  { chineseName: "鏃呰鍒嗚鐡跺瑁?, englishName: "Travel Bottles Set", keywords: "travel bottles,toiletry container,tsa approved", specs: "8浠跺;閫忔槑琚?, hsCode: "3923300000", purchasePrice: 2.25, productWeightG: 160, productSizeCm: { length: 17, width: 13, height: 4 } },
  { chineseName: "鍖栧鍒锋敹绾崇瓛", englishName: "Makeup Brush Holder", keywords: "makeup organizer,brush holder,vanity storage", specs: "閫忔槑浜氬厠鍔?3鏍?, hsCode: "3926909090", purchasePrice: 3.1, productWeightG: 250, productSizeCm: { length: 18, width: 8, height: 10 } },
  { chineseName: "棣栭グ鏃呰鏀剁撼鐩?, englishName: "Travel Jewelry Organizer Box", keywords: "jewelry box,travel organizer,earring storage", specs: "绮夎壊;渚挎惡", hsCode: "4202920000", purchasePrice: 4.7, productWeightG: 220, productSizeCm: { length: 16, width: 11, height: 5 } },
  { chineseName: "琛ｆ煖鍒嗗眰鏀剁撼鏋?, englishName: "Closet Shelf Divider", keywords: "closet organizer,shelf divider,wardrobe storage", specs: "4鍙;鐧借壊", hsCode: "3924900000", purchasePrice: 5.45, productWeightG: 540, productSizeCm: { length: 30, width: 28, height: 18 } },
  { chineseName: "閫忔槑闉嬬洅鏀剁撼绠?, englishName: "Clear Shoe Storage Boxes", keywords: "shoe box,clear storage,stackable organizer", specs: "6鍙;閫忔槑", hsCode: "3923100000", purchasePrice: 12.8, productWeightG: 1850, productSizeCm: { length: 34, width: 23, height: 14 } },
  { chineseName: "搴婂簳鏀剁撼琚?, englishName: "Under Bed Storage Bag", keywords: "under bed storage,clothes organizer,blanket bag", specs: "2鍙;鐏拌壊", hsCode: "6307909000", purchasePrice: 6.1, productWeightG: 650, productSizeCm: { length: 100, width: 45, height: 15 } },
  { chineseName: "鐪熺┖鍘嬬缉琚嬪瑁?, englishName: "Vacuum Storage Bags", keywords: "vacuum storage bag,space saver,clothes bag", specs: "10浠跺;鍚墜娉?, hsCode: "3923210000", purchasePrice: 7.95, productWeightG: 780, productSizeCm: { length: 70, width: 50, height: 0.2 } },
  { chineseName: "妗岄潰鏂囦欢鏀剁撼鐩?, englishName: "Desktop File Organizer Tray", keywords: "file tray,desk organizer,office storage", specs: "涓夊眰;榛戣壊閲戝睘", hsCode: "7326909000", purchasePrice: 8.3, productWeightG: 980, productSizeCm: { length: 33, width: 24, height: 18 } },
  { chineseName: "浜轰綋宸ュ榧犳爣鍨?, englishName: "Ergonomic Mouse Pad with Wrist Rest", keywords: "mouse pad,wrist rest,office accessory", specs: "榛戣壊;鍑濊兌鑵曟墭", hsCode: "4016999090", purchasePrice: 2.9, productWeightG: 260, productSizeCm: { length: 25, width: 22, height: 2 } },
  { chineseName: "绗旇鏈數鑴戞敮鏋?, englishName: "Adjustable Laptop Stand", keywords: "laptop stand,desk riser,aluminum holder", specs: "閾濆悎閲?鍙姌鍙?, hsCode: "7616999000", purchasePrice: 9.6, productWeightG: 720, productSizeCm: { length: 26, width: 21, height: 5 } },
  { chineseName: "鎵嬫満鐩存挱鏀灦", englishName: "Phone Tripod Stand", keywords: "phone tripod,live stream stand,selfie holder", specs: "160cm;甯﹁摑鐗欓仴鎺?, hsCode: "9620000000", purchasePrice: 6.85, productWeightG: 580, productSizeCm: { length: 45, width: 7, height: 7 } },
  { chineseName: "纾佸惛鎵嬫満杞﹁浇鏀灦", englishName: "Magnetic Car Phone Mount", keywords: "car phone mount,magnetic holder,dashboard", specs: "榛戣壊;寮虹", hsCode: "3926909090", purchasePrice: 3.55, productWeightG: 130, productSizeCm: { length: 6, width: 4, height: 4 } },
  { chineseName: "USB-C 鏁版嵁绾垮瑁?, englishName: "USB C Cable Set", keywords: "usb c cable,charging cord,fast charge", specs: "3鏉¤;1m/2m/3m", hsCode: "8544421100", purchasePrice: 4.25, productWeightG: 210, productSizeCm: { length: 300, width: 1, height: 0.5 } },
  { chineseName: "妗岄潰鍏呯數绾垮浐瀹氬す", englishName: "Cable Clips for Desk", keywords: "cable clips,cord organizer,desk accessory", specs: "20鍙;榛戠櫧", hsCode: "3926909090", purchasePrice: 1.45, productWeightG: 80, productSizeCm: { length: 3, width: 1.5, height: 1.2 } },
  { chineseName: "瀹犵墿鎱㈤纰?, englishName: "Slow Feeder Dog Bowl", keywords: "slow feeder bowl,dog bowl,pet feeding", specs: "涓彿;钃濊壊", hsCode: "3924900000", purchasePrice: 3.75, productWeightG: 310, productSizeCm: { length: 20, width: 20, height: 4.5 } },
  { chineseName: "瀹犵墿姣涘彂娓呮磥鍒?, englishName: "Pet Hair Remover Brush", keywords: "pet hair remover,lint brush,dog cat hair", specs: "鍙岄潰;鍙竻娲?, hsCode: "9603909090", purchasePrice: 2.85, productWeightG: 180, productSizeCm: { length: 19, width: 7, height: 4 } },
  { chineseName: "鐚爞閾叉敹绾冲瑁?, englishName: "Cat Litter Scoop Holder Set", keywords: "cat litter scoop,pet cleaning,holder", specs: "鐏拌壊;甯﹀簳搴?, hsCode: "3924900000", purchasePrice: 3.3, productWeightG: 260, productSizeCm: { length: 28, width: 12, height: 8 } },
  { chineseName: "鐙楃嫍璁粌鍝嶇墖", englishName: "Dog Training Clickers", keywords: "dog clicker,pet training,puppy trainer", specs: "6鍙;甯﹁厱缁?, hsCode: "3926909090", purchasePrice: 1.75, productWeightG: 90, productSizeCm: { length: 6, width: 4, height: 2 } },
  { chineseName: "渚挎惡瀹犵墿楗按鐡?, englishName: "Portable Dog Water Bottle", keywords: "dog water bottle,pet travel,bowl bottle", specs: "550ml;钃濊壊", hsCode: "3923300000", purchasePrice: 4.6, productWeightG: 230, productSizeCm: { length: 26, width: 8, height: 8 } },
  { chineseName: "鐟滀冀鎷夊姏甯﹀瑁?, englishName: "Resistance Bands Set", keywords: "resistance bands,yoga bands,workout set", specs: "5鏉¤;涓嶅悓闃诲姏", hsCode: "9506911900", purchasePrice: 3.8, productWeightG: 250, productSizeCm: { length: 30, width: 5, height: 0.5 } },
  { chineseName: "杩愬姩姘村６", englishName: "Motivational Sports Water Bottle", keywords: "water bottle,sports bottle,fitness", specs: "1L;甯﹀埢搴?, hsCode: "3923300000", purchasePrice: 3.95, productWeightG: 210, productSizeCm: { length: 28, width: 8, height: 8 } },
  { chineseName: "璺崇怀璁℃暟鍣?, englishName: "Jump Rope with Counter", keywords: "jump rope,counter skipping rope,fitness", specs: "榛戣壊;鏈烘璁℃暟", hsCode: "9506911900", purchasePrice: 2.65, productWeightG: 190, productSizeCm: { length: 300, width: 3, height: 3 } },
  { chineseName: "鑷杞︽墜鏈哄寘", englishName: "Bike Phone Frame Bag", keywords: "bike phone bag,bicycle pouch,cycling gear", specs: "闃叉按;瑙﹀睆绐?, hsCode: "4202920000", purchasePrice: 5.9, productWeightG: 260, productSizeCm: { length: 20, width: 10, height: 9 } },
  { chineseName: "鎴峰鎶樺彔鍧愬灚", englishName: "Foldable Camping Seat Pad", keywords: "camping pad,foldable seat,outdoor cushion", specs: "2鐗囪;闃叉疆", hsCode: "3926909090", purchasePrice: 2.2, productWeightG: 120, productSizeCm: { length: 38, width: 28, height: 1 } },
  { chineseName: "闇茶惀椁愬叿鏀剁撼琚?, englishName: "Camping Utensil Organizer Bag", keywords: "camping utensil bag,outdoor kitchen,travel pouch", specs: "榛戣壊;澶氶殧灞?, hsCode: "4202920000", purchasePrice: 6.35, productWeightG: 410, productSizeCm: { length: 36, width: 22, height: 5 } },
  { chineseName: "鍥壓鎵嬪甯︾埅", englishName: "Garden Gloves with Claws", keywords: "garden gloves,digging gloves,planting tool", specs: "1鍙?缁胯壊", hsCode: "6116100000", purchasePrice: 2.15, productWeightG: 140, productSizeCm: { length: 24, width: 13, height: 3 } },
  { chineseName: "妞嶇墿鏍囩鐗?, englishName: "Plastic Plant Labels", keywords: "plant labels,garden marker,seed tags", specs: "100鐗囪;鐧借壊", hsCode: "3926909090", purchasePrice: 1.35, productWeightG: 110, productSizeCm: { length: 10, width: 2, height: 0.2 } },
  { chineseName: "鍎跨椁愬灚", englishName: "Silicone Baby Placemat", keywords: "baby placemat,silicone mat,kids dining", specs: "闃叉粦;鍗￠€氭", hsCode: "3924100000", purchasePrice: 2.95, productWeightG: 220, productSizeCm: { length: 40, width: 30, height: 0.4 } },
  { chineseName: "濠村効鎺ㄨ溅鎸傞挬", englishName: "Stroller Hooks", keywords: "stroller hook,baby accessory,bag hanger", specs: "2鍙;榄旀湳璐?, hsCode: "3926909090", purchasePrice: 1.8, productWeightG: 95, productSizeCm: { length: 16, width: 5, height: 2 } },
  { chineseName: "鍎跨闃叉挒瑙?, englishName: "Baby Corner Protectors", keywords: "corner protector,baby safety,edge guard", specs: "24鍙;閫忔槑", hsCode: "3926909090", purchasePrice: 2.4, productWeightG: 150, productSizeCm: { length: 3, width: 3, height: 2 } },
  { chineseName: "姹借溅鍚庡绠辨敹绾崇", englishName: "Car Trunk Organizer", keywords: "trunk organizer,car storage,collapsible box", specs: "鍙姌鍙?榛戣壊", hsCode: "4202920000", purchasePrice: 8.75, productWeightG: 980, productSizeCm: { length: 55, width: 32, height: 28 } },
  { chineseName: "杞﹁浇鍨冨溇妗?, englishName: "Car Trash Can with Lid", keywords: "car trash can,auto organizer,mini bin", specs: "2L;甯︾洊", hsCode: "3924900000", purchasePrice: 3.45, productWeightG: 240, productSizeCm: { length: 18, width: 12, height: 20 } },
  { chineseName: "姹借溅搴ф缂濋殭濉?, englishName: "Car Seat Gap Filler", keywords: "seat gap filler,car organizer,auto accessory", specs: "2鍙;榛戣壊鐨潻", hsCode: "3926909090", purchasePrice: 4.15, productWeightG: 260, productSizeCm: { length: 42, width: 7, height: 4 } },
  { chineseName: "LED 姗辨煖鎰熷簲鐏?, englishName: "LED Motion Sensor Cabinet Light", keywords: "cabinet light,motion sensor led,closet light", specs: "2鍙;USB鍏呯數", hsCode: "9405429000", purchasePrice: 6.95, productWeightG: 310, productSizeCm: { length: 30, width: 4, height: 1.2 } },
  { chineseName: "澶槼鑳藉涵闄㈢伅", englishName: "Solar Garden Lights", keywords: "solar lights,pathway light,garden decor", specs: "8鍙;鏆栫櫧鍏?, hsCode: "9405410000", purchasePrice: 9.9, productWeightG: 920, productSizeCm: { length: 36, width: 6, height: 6 } },
  { chineseName: "鍙皟鑺備功绔?, englishName: "Adjustable Bookends", keywords: "bookends,desk book holder,office organizer", specs: "閲戝睘;鐧借壊", hsCode: "7326909000", purchasePrice: 4.85, productWeightG: 560, productSizeCm: { length: 15, width: 12, height: 20 } },
  { chineseName: "绀煎搧鍖呰绾告敹绾宠", englishName: "Wrapping Paper Storage Bag", keywords: "wrapping paper storage,gift wrap organizer", specs: "闀挎;闃插皹", hsCode: "6307909000", purchasePrice: 5.25, productWeightG: 360, productSizeCm: { length: 102, width: 35, height: 12 } },
];

const developers = ["闄堟灄", "鐜嬫偊", "鏉庤垷", "璧垫晱", "鍛ㄨ埅", "鍒樼惇", "瀛欐壃", "浣曞畨"];
const suppliers = ["涔変箤灏氬搧瀹跺眳", "瀹佹尝浼橀€夊涓?, "娣卞湷鏂拌繄鐢靛瓙", "鏇瑰幙鏈ㄧ洓鍧婃湪鍒跺搧鍘?, "骞垮窞涓囧悎鏃ョ敤鍝?, "涓滆帪鍚瘹浜旈噾", "鍘﹂棬钃濋哺鎴峰", "鏉窞灏忛箍姣嶅┐"];
const statuses: ProductStatus[] = ["pending", "developing", "ops_review", "listing_confirming", "listed", "canceled", "delisted", "patent_risk"];
const leadTimes = ["3澶?, "5澶?, "7澶?, "10澶?, "12澶?, "15澶?];

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
    developer: index === 0 ? "榛勬柉娑? : developers[index % developers.length],
    purchasePrice: seed.purchasePrice,
    status: index === 0 ? "developing" : statuses[index % statuses.length],
    supplierName: index === 0 ? "娣卞湷娉版矁鏁扮爜绉戞妧鏈夐檺鍏徃" : suppliers[index % suppliers.length],
    supplierUrl: index === 0 ? "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0" : `https://example.com/supplier/${sku}`,
    specs: seed.specs,
    purchaseLeadTime: index === 0 ? "" : leadTimes[index % leadTimes.length],
    createdAt: index === 0 ? "2026-07-23 20:37:13" : `2026-${String(6 + Math.floor(index / 30)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")} 00:00:00`,
    keywords: seed.keywords,
    note: index === 0 ? "鍜栧暋鐖卞ソ鑰?/ 鍜栧暋甯堢敤浜庤瀵熷挅鍟℃恫娴佸嚭褰㈡€侊紱閲嶇偣鏀硅繘寮虹搴曞骇銆?M鑳岃兌寮曠鐗囥€侀鏈虹洅鍜岃鏄庝功銆? : index % 5 === 4 ? "娉ㄦ剰妫€鏌ュ瑙備笓鍒╀笌鍏抽敭璇嶅悎瑙勩€? : "婕旂ず鏁版嵁锛屽彲鍦ㄨ鎯呴〉缁х画琛ュ厖閲囪喘鍜屼笂鏋朵俊鎭€?,
    cancelReason: statuses[index % statuses.length] === "canceled" ? "婕旂ず鏁版嵁锛氫緵搴斿晢鎶ヤ环鎴栧悎瑙勯闄╀笉绗﹀悎缁х画寮€鍙戣姹傘€? : "",
    hsCode: seed.hsCode,
    images: [],
    competitorAsins: index === 0 ? ["B0D2WNHF3V", "B0BJP1FM72", "B0DM1TB116", "B0F9Y1C7MZ", "B0GVDVJDVH", "B0BXCLX3HC"] : [`B0${String(20000000 + index * 5179).slice(0, 8)}`, `B0${String(30000000 + index * 6833).slice(0, 8)}`],
    productWeightG: seed.productWeightG,
    packageWeightG: index === 0 ? 108.86 : seed.productWeightG + 90 + (index % 6) * 25,
    productSizeCm: seed.productSizeCm,
    packageSizeCm: index === 0 ? { length: 9.14, width: 9.14, height: 5.33 } : packageSizeCm,
  };
});
