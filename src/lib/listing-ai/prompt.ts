import type { ListingOptimizationRequest } from "./types";

const marketplaceRules = {
  US: "Amazon US. Title should usually stay under 200 characters. Write natural American English unless the user requested Chinese output.",
  UK: "Amazon UK. Use British spelling when writing English.",
  DE: "Amazon Germany. Avoid unsupported medical, ranking, and guarantee claims.",
  FR: "Amazon France. Avoid unsupported medical, ranking, and guarantee claims.",
  IT: "Amazon Italy. Avoid unsupported medical, ranking, and guarantee claims.",
  ES: "Amazon Spain. Avoid unsupported medical, ranking, and guarantee claims.",
  JP: "Amazon Japan. Keep language concise and search-oriented.",
  CA: "Amazon Canada. Use clear English and avoid unsupported claims.",
  AU: "Amazon Australia. Use clear English and avoid unsupported claims.",
};

export function buildListingOptimizationPrompt(input: ListingOptimizationRequest) {
  return [
    {
      role: "system",
      content:
        "You are a senior Amazon product operations director, ecommerce visual creative director, and software product manager. Your job is to generate a complete Amazon listing and visual execution plan that operations and designers can execute directly. The strongest selling point must be amplified across title, bullets, main images, secondary images, and A+ content. Return only valid JSON. Do not include markdown fences.",
    },
    {
      role: "user",
      content: `
Generate a one-click Amazon Listing + Main Image + Secondary Image + A+ execution plan.

Output language: ${input.language}
Marketplace: ${input.marketplace}
Marketplace rules: ${marketplaceRules[input.marketplace]}
Tone: ${input.tone}
Submitter: ${input.submitter || "Not provided"}

Required JSON schema:
{
  "score": number from 0 to 100,
  "positioning": {
    "oneSentence": "define what this product sells",
    "strongestSellingPoint": "the single strongest selling point to amplify",
    "buyerReason": "why buyers care",
    "competitorOpportunity": "what competitors did not explain clearly"
  },
  "aiAnalysis": {
    "position": "product market position",
    "strength": ["our strengths"],
    "weakness": ["our weaknesses or missing facts"],
    "opportunity": ["competitor gaps and conversion opportunities"],
    "risk": ["compliance, proof, image, keyword, or conversion risks"]
  },
  "titleOptions": [
    { "type": "seo|conversion|balanced", "title": "title", "primaryKeywords": "where primary keywords appear", "secondaryKeywords": "where secondary keywords appear", "sellingPointWords": "where selling point words appear", "selfCheck": "3-second buyer scan check" }
  ],
  "title": "recommended final title",
  "bullets": [
    { "bullet": "English Amazon bullet", "chineseExplanation": "Chinese explanation", "sellingPoint": "corresponding selling point", "imageExpression": "how image should express it", "needsFactCheck": "missing fact or no" }
  ],
  "description": "optimized description",
  "backendSearchTerms": "space-separated backend search terms, no duplicate words, no commas",
  "keywordCoverage": [
    { "keyword": "keyword", "priority": "primary|secondary|long-tail|ad-data", "placement": "title|bullets|description|backend|missing", "note": "short note" }
  ],
  "imagePlan": [
    {
      "imageNo": "Main Image 1",
      "slot": "Main Image|Image 2|Image 3|Image 4|Image 5|Image 6|Image 7|Image 8",
      "theme": "image theme",
      "buyerTakeaway": "what buyers should remember in one sentence",
      "layout": "composition and information hierarchy",
      "productAngle": "product angle and display details",
      "amplifiedSellingPoint": "selling point to enlarge",
      "englishCopy": "on-image English copy, empty for main image if needed",
      "designerInstruction": "Chinese execution instruction for designer",
      "competitorReference": "what to learn from competitors",
      "avoid": "must avoid",
      "selfCheck": "delivery standard",
      "cnPrompt": "Chinese AI image prompt",
      "enPrompt": "English AI image prompt",
      "negativePrompt": "negative prompt",
      "finishingRequirements": "lighting, texture, retouching requirements"
    }
  ],
  "aplusPlan": [
    { "moduleNo": "A+ 1", "coreMessage": "core message", "layout": "layout structure", "copy": "title + subtitle + short body", "visualElements": "visual elements" }
  ],
  "designerChecklist": [
    { "imageNo": "Image number", "checklist": ["self-check item"] }
  ],
  "aiReview": {
    "listingScore": number from 0 to 100,
    "imageScore": number from 0 to 100,
    "aplusScore": number from 0 to 100,
    "keywordScore": number from 0 to 100,
    "buyerDesireScore": number from 0 to 100,
    "verdict": "whether this can be delivered or must be regenerated",
    "mustFix": ["non-negotiable fixes"],
    "regenerationAdvice": ["how to regenerate better next time"]
  },
  "complianceNotes": ["risk or compliance note"],
  "nextActions": ["specific seller action"]
}

Core rules:
- The main selling point must be amplified repeatedly. Every title, bullet, image, and A+ module must build a purchase reason around it.
- Judge from buyer perspective: can buyers understand the advantage within 3 seconds, and do they want to buy?
- Images are not merely beautiful. They must have clear selling points, clean hierarchy, premium product texture, credible details, and persuasive comparison.
- Every image plan must include a self-check. If the image can still be criticized, mark what must be improved.
- If facts are missing, do not invent certifications, dimensions, compatibility, materials, warranty, medical benefits, or performance claims.
- Main image must follow Amazon style: clean product-focused, no promotional badges, no unsupported overlays.
- Generate exactly 3 title options: SEO coverage, conversion selling-point, balanced recommendation.
- Generate exactly 5 bullets.
- Generate 7-8 main/secondary image plans for 1601x1601px.
- Generate 5 A+ modules for 960x600px.
- AI Analysis is the core, not a chat response. It must include Position, Strength, Weakness, Opportunity, and Risk.
- AI Review must judge whether the result is good enough from a buyer and designer perspective. If not, explain what must be regenerated.
- For competitor comparisons, use only claims supported by provided information. Unknowns must be marked "需确认".

Product basic information:
Chinese name: ${input.productChineseName || "Not provided"}
English name: ${input.productEnglishName || "Not provided"}
ASIN: ${input.asin || "Not provided"}
Brand: ${input.brand || "Not provided"}
Product type: ${input.productType || "Not provided"}
Target audience: ${input.targetAudience || "Not provided"}
Use scenarios: ${input.useScenarios || "Not provided"}
Variation info: ${input.variationInfo || "Not provided"}

Own product facts:
Product facts: ${input.productFacts || "Not provided"}
Main selling point 1: ${input.mainSellingPoint1 || "Not provided"}
Main selling point 2: ${input.mainSellingPoint2 || "Not provided"}
Main selling point 3: ${input.mainSellingPoint3 || "Not provided"}
Other selling points: ${input.otherSellingPoints || "Not provided"}
Material: ${input.material || "Not provided"}
Dimensions: ${input.dimensions || "Not provided"}
Package list: ${input.packageList || "Not provided"}
Accessories: ${input.accessories || "Not provided"}
Special structure: ${input.specialStructure || "Not provided"}
Details to amplify: ${input.detailsToAmplify || "Not provided"}

Current listing:
Current title: ${input.currentTitle || "Not provided"}
Current bullets: ${input.currentBullets || "Not provided"}
Current description: ${input.currentDescription || "Not provided"}
Keywords that should enter title: ${input.titleKeywords || "Not provided"}
Keywords that should enter bullets: ${input.bulletKeywords || "Not provided"}
Advertising data and keyword performance:
${input.adData || "Not provided"}

Competitor information. Compare 3 competitors side by side where possible; our product is the rightmost benchmark:
${input.competitorInfo || "Not provided"}

Image and A+ requirements:
Image requirements: ${input.imageRequirements || "Not provided"}
A+ requirements: ${input.aplusRequirements || "Not provided"}

Legacy compact fields if present:
Brand:
${input.brand || "Not provided"}
`.trim(),
    },
  ];
}
