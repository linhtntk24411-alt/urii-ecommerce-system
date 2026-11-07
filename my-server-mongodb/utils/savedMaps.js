function prepareSavedMaps(savedMapData, users, gallery) {
  if (!savedMapData || !Array.isArray(savedMapData.users)
    || !Array.isArray(users) || !Array.isArray(gallery)) {
    throw new TypeError('Saved map data, customers, and gallery must be arrays.');
  }

  const usersById = new Map(
    users.filter((user) => user.role === 'user').map((user) => [String(user._id), user])
  );
  const galleryById = new Map(gallery.map((map) => [map.map_id, map]));
  const seenUsers = new Set();
  const seenCustomerMaps = new Set();
  const savedMaps = [];

  for (const customerMaps of savedMapData.users) {
    const user = usersById.get(String(customerMaps.userId));
    if (!user) {
      throw new Error(`Saved maps do not reference an existing customer "${customerMaps.userId}".`);
    }
    if (seenUsers.has(String(user._id))) {
      throw new Error(`Saved maps contain duplicate user "${user._id}".`);
    }
    if (!Array.isArray(customerMaps.mapIds)
      || customerMaps.mapIds.length < 2
      || customerMaps.mapIds.length > 5) {
      throw new Error(`Customer "${user._id}" must have 2-5 saved maps.`);
    }

    seenUsers.add(String(user._id));
    const seenMapIds = new Set();
    for (const mapId of customerMaps.mapIds) {
      if (seenMapIds.has(mapId)) {
        throw new Error(`Customer "${user._id}" has duplicate saved map "${mapId}".`);
      }
      const galleryMap = galleryById.get(mapId);
      if (!galleryMap) {
        throw new Error(`Saved map "${mapId}" does not exist in the gallery.`);
      }

      seenMapIds.add(mapId);
      const customerMap = `${String(user._id)}:${mapId}`;
      if (seenCustomerMaps.has(customerMap)) {
        throw new Error(`Customer "${user._id}" has duplicate saved map "${mapId}".`);
      }
      seenCustomerMaps.add(customerMap);
      savedMaps.push({
        id: `saved-${String(user._id)}-${mapId}`,
        userId: user._id,
        mapId,
        title: galleryMap.map_name,
        author: galleryMap.author,
        image: galleryMap.main_image,
        liked: true
      });
    }
  }

  if (seenUsers.size !== usersById.size) {
    throw new Error('Every customer must have saved-map records.');
  }
  return savedMaps;
}

module.exports = { prepareSavedMaps };
