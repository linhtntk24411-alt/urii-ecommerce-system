const { isValidImageUrl } = require('./imageUrl');

function getProductPrice(product, variantIndex) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  let variant = null;
  let normalizedVariantIndex = null;

  if (variants.length > 0) {
    normalizedVariantIndex = variantIndex === undefined || variantIndex === null ? 0 : variantIndex;
    if (!Number.isInteger(normalizedVariantIndex)
      || normalizedVariantIndex < 0
      || normalizedVariantIndex >= variants.length) {
      throw new RangeError(`Phân loại của sản phẩm "${product.id}" không hợp lệ.`);
    }
    variant = variants[normalizedVariantIndex];
  } else if (variantIndex !== undefined && variantIndex !== null) {
    throw new RangeError(`Sản phẩm "${product.id}" không có phân loại.`);
  }

  const price = variant?.price ?? product.currentPrice ?? product.originalPrice;
  const stock = variant?.stock ?? product.stock ?? 0;
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    throw new TypeError(`Giá hoặc tồn kho sản phẩm "${product.id}" không hợp lệ.`);
  }

  return {
    variantIndex: normalizedVariantIndex,
    variantName: variant?.name ?? null,
    price,
    stock,
    image: variant?.image || product.image || null
  };
}

function normalizeCartItem(item, product, { generateItemId } = {}) {
  const pricing = getProductPrice(product, item.variantIndex);
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    throw new RangeError('Số lượng sản phẩm phải là số nguyên dương.');
  }
  if (item.quantity > pricing.stock) {
    throw new RangeError(`Sản phẩm "${product.name}" chỉ còn ${pricing.stock} sản phẩm.`);
  }
  return {
    itemId: item.itemId || generateItemId?.(),
    productId: product.id,
    variantIndex: pricing.variantIndex,
    quantity: item.quantity,
    selected: item.selected ?? true
  };
}

function prepareCartFixtures(cartData, users, products) {
  if (!cartData || !Array.isArray(cartData.carts)
    || !Array.isArray(users) || !Array.isArray(products)) {
    throw new TypeError('Cart fixtures, users, and products must be arrays.');
  }

  const usersById = new Map(users.filter((user) => user.role === 'user' && user._id)
    .map((user) => [String(user._id), user]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seenUsers = new Set();

  return cartData.carts.map((cart) => {
    const userId = String(cart.userId);
    if (!usersById.has(userId) || seenUsers.has(userId)) {
      throw new Error(`Cart "${userId}" does not reference one unique customer.`);
    }
    if (!Array.isArray(cart.items)) {
      throw new TypeError(`Cart "${userId}" items must be an array.`);
    }
    const itemKeys = new Set();
    const items = cart.items.map((item) => {
      const product = productsById.get(item.productId);
      if (!product) {
        throw new Error(`Cart item references unknown product "${item.productId}".`);
      }
      const normalized = normalizeCartItem(item, product);
      if (!normalized.itemId || typeof normalized.selected !== 'boolean') {
        throw new TypeError(`Cart item for "${product.id}" is invalid.`);
      }
      const key = `${normalized.productId}:${normalized.variantIndex ?? 'default'}`;
      if (itemKeys.has(key)) {
        throw new Error(`Cart "${userId}" contains a duplicate product variant.`);
      }
      itemKeys.add(key);
      return normalized;
    });
    seenUsers.add(userId);
    return { userId: usersById.get(userId)._id, items };
  });
}

function buildCartResponse(cart, products) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  let selectedSubtotal = 0;
  let quantityCount = 0;
  let selectedQuantityCount = 0;

  const items = cart.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new Error(`Cart product "${item.productId}" no longer exists.`);
    }
    const pricing = getProductPrice(product, item.variantIndex);
    const lineTotal = pricing.price * item.quantity;
    subtotal += lineTotal;
    quantityCount += item.quantity;
    if (item.selected) {
      selectedSubtotal += lineTotal;
      selectedQuantityCount += item.quantity;
    }
    return {
      itemId: item.itemId,
      productId: product.id,
      productName: product.name,
      image: pricing.image,
      variantIndex: pricing.variantIndex,
      variantName: pricing.variantName,
      unitPrice: pricing.price,
      quantity: item.quantity,
      stock: pricing.stock,
      selected: item.selected,
      lineTotal
    };
  });

  return {
    userId: String(cart.userId),
    items,
    itemCount: items.length,
    quantityCount,
    selectedItemCount: items.filter((item) => item.selected).length,
    selectedQuantityCount,
    subtotal,
    selectedSubtotal
  };
}

function prepareReviewFixtures(reviewData, users, products) {
  if (!reviewData || !Array.isArray(reviewData.orders)
    || !Array.isArray(reviewData.reviews)
    || !Array.isArray(users) || !Array.isArray(products)) {
    throw new TypeError('Review order fixtures, users, and products must be arrays.');
  }

  const usersById = new Map(users.filter((user) => user.role === 'user' && user._id)
    .map((user) => [String(user._id), user]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const orderIds = new Set();
  const reviewIds = new Set();
  const reviewPairs = new Set();
  const reviewedProductIds = new Set();
  const orders = reviewData.orders.map((order) => {
    const user = usersById.get(String(order.userId));
    if (!user || !order.id || order.statusId !== 'completed'
      || !Array.isArray(order.items) || order.items.length === 0
      || !Number.isFinite(new Date(order.deliveredAt).getTime())) {
      throw new Error(`Order "${order.id}" must be a delivered order with a valid customer and items.`);
    }
    if (orderIds.has(order.id)) {
      throw new Error(`Order ID "${order.id}" is duplicated.`);
    }
    orderIds.add(order.id);

    const productIds = new Set();
    const items = order.items.map((item) => {
      const product = productsById.get(item.productId);
      if (!product || productIds.has(item.productId)) {
        throw new Error(`Order "${order.id}" has an invalid or duplicate product "${item.productId}".`);
      }
      productIds.add(item.productId);
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const variantIndex = item.variantIndex ?? null;
      if (variants.length
        ? !Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= variants.length
        : variantIndex !== null) {
        throw new Error(`Order "${order.id}" has an invalid variant for product "${item.productId}".`);
      }
      const pricing = getProductPrice(product, variantIndex);
      return {
        productId: product.id,
        unitPrice: pricing.price,
        quantity: 1,
        variantIndex,
        variantName: pricing.variantName || 'Mặc định'
      };
    });

    const deliveredAt = new Date(order.deliveredAt);
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice, 0);
    return {
      id: order.id,
      userId: user._id,
      date: `${String(deliveredAt.getUTCDate()).padStart(2, '0')}/${String(deliveredAt.getUTCMonth() + 1).padStart(2, '0')}/${deliveredAt.getUTCFullYear()}`,
      statusId: 'completed',
      showReview: false,
      totalAmount: subtotal,
      items,
      payment: { methodId: 'cod', statusId: 'paid' },
      shipping: {
        methodId: 'ghtk_standard',
        trackingNumber: `GHK-${order.id}`,
        fee: 0,
        estimatedDelivery: deliveredAt
      },
      deliveredAt
    };
  });
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  const reviews = reviewData.reviews.map((review, index) => {
    const order = ordersById.get(review.orderId);
    const item = order?.items.find((orderItem) => orderItem.productId === review.productId);
    const user = order && usersById.get(String(order.userId));
    const media = review.media ?? [];
    if (!order || !user || !item) {
      throw new Error(`Review "${review.id}" must link to a delivered order item.`);
    }
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5
      || typeof review.content !== 'string' || review.content.trim().length > 1000
      || !Array.isArray(media) || media.length > 5
      || media.some((attachment) => !['image', 'video'].includes(attachment.type)
        || !isValidImageUrl(attachment.url))
      || (review.createdAt && new Date(review.createdAt) <= new Date(order.deliveredAt))) {
      throw new Error(`Review "${review.id}" has invalid rating, content, or media.`);
    }
    const reviewId = review.id || `review-${review.orderId}-${review.productId}`;
    const createdAt = review.createdAt
      ? new Date(review.createdAt)
      : new Date(new Date(order.deliveredAt).getTime() + (index + 1) * 3_600_000);
    const pair = `${review.orderId}:${review.productId}`;
    if (reviewIds.has(reviewId) || reviewPairs.has(pair)) {
      throw new Error(`Review "${reviewId}" or order/product pair is duplicated.`);
    }
    reviewIds.add(reviewId);
    reviewPairs.add(pair);
    reviewedProductIds.add(review.productId);
    return {
      id: reviewId,
      orderId: review.orderId,
      userId: user._id,
      productId: review.productId,
      rating: review.rating,
      variantIndex: item.variantIndex,
      variantName: item.variantName,
      content: review.content.trim(),
      media,
      createdAt
    };
  });

  for (const order of orders) {
    const orderReviews = reviews.filter((review) => review.orderId === order.id);
    order.showReview = order.items.some((item) => !orderReviews.some(
      (review) => review.productId === item.productId
    ));
  }

  if (reviewedProductIds.size !== productsById.size
    || [...productsById.keys()].some((productId) => !reviewedProductIds.has(productId))) {
    throw new Error('Every product must have at least one review from a delivered order.');
  }

  return { orders, reviews };
}

function calculateProductRatingStats(reviews) {
  if (!Array.isArray(reviews)) {
    throw new TypeError('Reviews must be an array.');
  }

  const buckets = new Map();
  for (const review of reviews) {
    if (!review?.productId || !Number.isFinite(review.rating)) continue;
    const current = buckets.get(review.productId) || { sum: 0, count: 0 };
    current.sum += review.rating;
    current.count += 1;
    buckets.set(review.productId, current);
  }

  const statsByProductId = new Map();
  for (const [productId, { sum, count }] of buckets.entries()) {
    statsByProductId.set(productId, {
      rating: count > 0 ? Number((sum / count).toFixed(2)) : 0,
      reviewCount: count
    });
  }
  return statsByProductId;
}

function applyProductRatings(products, reviews) {
  if (!Array.isArray(products)) {
    throw new TypeError('Products must be an array.');
  }
  const statsByProductId = calculateProductRatingStats(reviews);
  return products.map((product) => {
    const stats = statsByProductId.get(product.id) || { rating: 0, reviewCount: 0 };
    return {
      ...product,
      rating: stats.rating,
      reviewCount: stats.reviewCount
    };
  });
}

async function syncProductRating(productId, { ReviewModel, ProductModel } = {}) {
  const aggregate = await ReviewModel.aggregate([
    { $match: { productId } },
    {
      $group: {
        _id: '$productId',
        reviewCount: { $sum: 1 },
        ratingSum: { $sum: '$rating' }
      }
    }
  ]);
  const summary = aggregate[0];
  const reviewCount = summary?.reviewCount || 0;
  const rating = reviewCount > 0 ? Number((summary.ratingSum / reviewCount).toFixed(2)) : 0;

  await ProductModel.findOneAndUpdate(
    { id: productId },
    { $set: { rating, reviewCount } },
    { new: true }
  );

  return { productId, rating, reviewCount };
}

async function syncAllProductRatings({ ReviewModel, ProductModel } = {}) {
  const aggregate = await ReviewModel.aggregate([
    {
      $group: {
        _id: '$productId',
        reviewCount: { $sum: 1 },
        ratingSum: { $sum: '$rating' }
      }
    }
  ]);

  if (aggregate.length === 0) return [];

  const operations = aggregate.map((entry) => ({
    updateOne: {
      filter: { id: entry._id },
      update: {
        $set: {
          rating: Number((entry.ratingSum / entry.reviewCount).toFixed(2)),
          reviewCount: entry.reviewCount
        }
      }
    }
  }));

  return ProductModel.bulkWrite(operations, { ordered: true });
}

module.exports = {
  applyProductRatings,
  buildCartResponse,
  calculateProductRatingStats,
  getProductPrice,
  normalizeCartItem,
  prepareCartFixtures,
  prepareReviewFixtures,
  syncAllProductRatings,
  syncProductRating
};
