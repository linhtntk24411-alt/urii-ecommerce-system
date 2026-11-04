function prepareLikedProducts(likedProductData, users, products) {
  if (!likedProductData || !Array.isArray(likedProductData.users)
    || !Array.isArray(users) || !Array.isArray(products)) {
    throw new TypeError('Liked product data, customers, and products must be arrays.');
  }

  const usersById = new Map(
    users.filter((user) => user.role === 'user' && user._id).map((user) => [String(user._id), user])
  );
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seenUsers = new Set();
  const seenCustomerProducts = new Set();
  const likedProducts = [];

  for (const customerProducts of likedProductData.users) {
    const user = usersById.get(String(customerProducts.userId));
    if (!user) {
      throw new Error(`Liked products do not reference an existing customer "${customerProducts.userId}".`);
    }
    if (seenUsers.has(String(user._id))) {
      throw new Error(`Liked products contain duplicate user "${user._id}".`);
    }
    if (!Array.isArray(customerProducts.productIds)
      || customerProducts.productIds.length < 2
      || customerProducts.productIds.length > 10) {
      throw new Error(`Customer "${user._id}" must have 2-10 liked products.`);
    }

    seenUsers.add(String(user._id));
    const seenProductIds = new Set();
    for (const productId of customerProducts.productIds) {
      if (seenProductIds.has(productId)) {
        throw new Error(`Customer "${user._id}" has duplicate liked product "${productId}".`);
      }
      const product = productsById.get(productId);
      if (!product) {
        throw new Error(`Liked product "${productId}" does not exist in products.`);
      }

      seenProductIds.add(productId);
      const customerProduct = `${String(user._id)}:${productId}`;
      if (seenCustomerProducts.has(customerProduct)) {
        throw new Error(`Customer "${user._id}" has duplicate liked product "${productId}".`);
      }
      seenCustomerProducts.add(customerProduct);
      likedProducts.push({
        id: `liked-${String(user._id)}-${productId}`,
        userId: user._id,
        productId: product.id,
        liked: true
      });
    }
  }

  if (seenUsers.size !== usersById.size) {
    throw new Error('Every customer must have liked-product records.');
  }
  return likedProducts;
}

module.exports = { prepareLikedProducts };
