// Keep layout-dependent selectors in this file. Fixtures exercise these same parsers.
export const selectors = {
  blockedForm: 'form[action*="validateCaptcha"], #captchacharacters, input[name="captcha"], input[type="password"]',
  searchCard: '[data-component-type="s-search-result"][data-asin]',
  searchTitle: 'h2 span, h2', searchPrice: '.a-price .a-offscreen',
  searchRating: '.a-icon-alt', searchReviews: '[data-cy="reviews-block"] a span.a-size-base, a[href*="customerReviews"] span, a[href*="product-reviews"] span',
  bestCard: '[id*="gridItemRoot"]', bestLink: 'a[href*="/dp/"]',
  title: '#productTitle', price: '#corePrice_feature_div .a-price .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  rating: '#acrPopover .a-icon-alt', reviewsCount: '#acrCustomerReviewText',
  bsr: '#productDetails_detailBullets_sections1, #detailBullets_feature_div, #prodDetails',
  bullets: '#feature-bullets li .a-list-item', image: '#landingImage, #imgBlkFront',
  variations: '#twister .a-button-text, #twister .selection, [id^="variation_"] li',
  review: '[data-hook="review"]', reviewStar: '[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]',
  reviewDate: '[data-hook="review-date"]', reviewText: '[data-hook="review-body"]',
  nextReviews: '.a-pagination .a-last a',
  supplierCard: '.offer-list-row-offer, .search-offer-wrapper, [data-offer-id]',
  supplierTitle: '.title, .offer-title, .title-text', supplierPrice: '.price, .offer-price',
  supplierShop: '.company-name, .shop-name', supplierMoq: '.moq, .offer-min-order', supplierLink: 'a[href*="detail.1688.com/offer/"]',
};
