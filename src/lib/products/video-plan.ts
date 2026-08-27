export type ProductVideoReference = {
  label: string;
  url: string;
};

export type ProductVideoAsset = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedAt: string;
};

export type ProductVideoShot = {
  id: string;
  shotNo: number;
  sellingPoint: string;
  sceneContent: string;
  shotType: string;
  cameraMove: string;
  duration: string;
  angle: string;
  effectReference: string;
  copyEnglish: string;
  images: ProductVideoAsset[];
};

export type ProductVideoProp = {
  id: string;
  imageUrl: string;
  spec: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  purchasePlatform: string;
  purchaseLink: string;
  images: ProductVideoAsset[];
};

export type ProductVideoPlanDraft = {
  propsSceneRequirements: string;
  propsSceneRequirementImages: ProductVideoAsset[];
  videoType: string;
  videoTypeImages: ProductVideoAsset[];
  styleConfirmation: string;
  styleConfirmationImages: ProductVideoAsset[];
  backgroundMusic: string;
  backgroundMusicFiles: ProductVideoAsset[];
  references: ProductVideoReference[];
  shots: ProductVideoShot[];
  props: ProductVideoProp[];
  productionNotes: string;
};

export function createEmptyProductVideoPlan(): ProductVideoPlanDraft {
  return {
    propsSceneRequirements: "主图视频：商品详情页视频",
    propsSceneRequirementImages: [],
    videoType: "简约大气，浪漫，有氛围",
    videoTypeImages: [],
    styleConfirmation: "",
    styleConfirmationImages: [],
    backgroundMusic: "",
    backgroundMusicFiles: [],
    references: [
      { label: "参考视频1", url: "" },
      { label: "参考视频2", url: "" },
      { label: "参考视频3", url: "" },
    ],
    shots: [
      createVideoShot(1, { sceneContent: "场景图，三色同时展示，做成封面", shotType: "全景", cameraMove: "固定镜头", duration: "3s", angle: "正面" }),
      createVideoShot(2, { sellingPoint: "场景氛围价值", sceneContent: "用 AI 生成一段户外场景效果，花要贴到箱外", shotType: "全景", cameraMove: "慢慢推进", duration: "2s" }),
      createVideoShot(3, { sellingPoint: "场景氛围价值", sceneContent: "用 AI 生成一段室内场景效果，慢慢推进时有人走来投入卡片，穿得正式一点", shotType: "全景", cameraMove: "慢慢推进", duration: "2s" }),
      createVideoShot(4, { sellingPoint: "转一圈展示细节", sceneContent: "保持箱子，有内有一张卡片，旋转到对应侧面，放大展示第一个细节文字印刷", shotType: "全景", cameraMove: "固定镜头" }),
      createVideoShot(5, { sellingPoint: "转一圈展示细节", sceneContent: "接着旋转放大第二个细节，侧面拼接无缝，手接着这个场角滑下来的动作", shotType: "特写", cameraMove: "拉大至特写镜头", duration: "3s", angle: "侧面" }),
      createVideoShot(6, { sellingPoint: "转一圈展示细节", sceneContent: "接着旋转放大第三个细节，对着卡槽的位置，投入一封卡片取信", shotType: "近景", cameraMove: "缩小至近景", duration: "3s" }),
      createVideoShot(7, { sellingPoint: "转一圈展示细节", sceneContent: "手拉出滑盖，强调顺滑开合，把卡在箱内取出来", shotType: "近景", cameraMove: "缩小至近景", duration: "3s" }),
      createVideoShot(8, { sellingPoint: "花朵 DIY 方式", sceneContent: "展示贴胶、撕贴到盒子上，再撒下花瓣，字幕花朵装饰可手贴上", shotType: "全景", cameraMove: "固定镜头" }),
      createVideoShot(9, { sellingPoint: "花朵 DIY 方式", sceneContent: "三个视频同时展示不同使用方式，保持同样速度慢慢旋转", shotType: "全景", cameraMove: "固定镜头" }),
      createVideoShot(10, { sceneContent: "婚庆图，婚礼 Wedding；新娘婚前派对 Bridal Shower；迎婴派对 Baby Showers", shotType: "全景", cameraMove: "缩至全景 + 固定镜头", duration: "5s", angle: "正前方" }),
    ],
    props: [
      createVideoProp({ spec: "白色一套", quantity: 1, unitPrice: 11.5, purchasePlatform: "拼多多" }),
      createVideoProp({ spec: "白色 145*260cm", quantity: 1, unitPrice: 8.8 }),
      createVideoProp({ spec: "21 白 30*180", quantity: 3, unitPrice: 1 }),
      createVideoProp({ spec: "商瓜", quantity: 1, unitPrice: 13.5, purchasePlatform: "1688" }),
    ],
    productionNotes: "",
  };
}

export function normalizeProductVideoPlan(draft: Partial<ProductVideoPlanDraft> | null | undefined): ProductVideoPlanDraft {
  const fallback = createEmptyProductVideoPlan();

  return {
    propsSceneRequirements: draft?.propsSceneRequirements ?? fallback.propsSceneRequirements,
    propsSceneRequirementImages: normalizeAssets(draft?.propsSceneRequirementImages),
    videoType: draft?.videoType ?? fallback.videoType,
    videoTypeImages: normalizeAssets(draft?.videoTypeImages),
    styleConfirmation: draft?.styleConfirmation ?? fallback.styleConfirmation,
    styleConfirmationImages: normalizeAssets(draft?.styleConfirmationImages),
    backgroundMusic: draft?.backgroundMusic ?? fallback.backgroundMusic,
    backgroundMusicFiles: normalizeAssets(draft?.backgroundMusicFiles),
    references: Array.isArray(draft?.references) && draft.references.length
      ? draft.references.map((reference, index) => ({
          label: reference.label || `参考视频${index + 1}`,
          url: reference.url || "",
        }))
      : fallback.references,
    shots: Array.isArray(draft?.shots) && draft.shots.length
      ? draft.shots.map((shot, index) => ({
          ...createVideoShot(index + 1),
          ...shot,
          id: shot.id || `shot-${index + 1}`,
          shotNo: Number(shot.shotNo) || index + 1,
          images: normalizeAssets(shot.images),
        }))
      : fallback.shots,
    props: Array.isArray(draft?.props) && draft.props.length
      ? draft.props.map((item, index) => normalizeVideoProp(item, index))
      : fallback.props,
    productionNotes: draft?.productionNotes ?? fallback.productionNotes,
  };
}

function normalizeAssets(assets: ProductVideoAsset[] | undefined): ProductVideoAsset[] {
  if (!Array.isArray(assets)) return [];

  return assets
    .filter((asset) => asset && asset.id && asset.url)
    .map((asset) => ({
      id: asset.id,
      name: asset.name || "未命名素材",
      mimeType: asset.mimeType || "application/octet-stream",
      size: Number(asset.size) || 0,
      url: asset.url,
      uploadedAt: asset.uploadedAt || new Date().toISOString(),
    }));
}

export function createVideoShot(shotNo: number, patch: Partial<Omit<ProductVideoShot, "id" | "shotNo">> = {}): ProductVideoShot {
  return {
    id: `shot-${Date.now()}-${shotNo}`,
    shotNo,
    sellingPoint: "",
    sceneContent: "",
    shotType: "",
    cameraMove: "",
    duration: "",
    angle: "",
    effectReference: "",
    copyEnglish: "",
    images: [],
    ...patch,
  };
}

export function createVideoProp(patch: Partial<Omit<ProductVideoProp, "id" | "totalPrice" | "images">> & { images?: ProductVideoAsset[] } = {}): ProductVideoProp {
  const quantity = patch.quantity ?? 1;
  const unitPrice = patch.unitPrice ?? 0;

  return {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    imageUrl: "",
    spec: "",
    quantity,
    unitPrice,
    totalPrice: Number((quantity * unitPrice).toFixed(2)),
    purchasePlatform: "",
    purchaseLink: "",
    images: [],
    ...patch,
  };
}

function normalizeVideoProp(item: ProductVideoProp, index: number): ProductVideoProp {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;

  return {
    ...createVideoProp(),
    ...item,
    id: item.id || `prop-${index + 1}`,
    quantity,
    unitPrice,
    totalPrice: Number((quantity * unitPrice).toFixed(2)),
    images: normalizeAssets(item.images),
  };
}
