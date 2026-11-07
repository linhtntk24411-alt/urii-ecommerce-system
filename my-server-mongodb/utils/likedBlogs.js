function prepareLikedBlogs(likedBlogData, users, blogs) {
  if (!likedBlogData || !Array.isArray(likedBlogData.users)
    || !Array.isArray(users) || !Array.isArray(blogs)) {
    throw new TypeError('Liked blog data, customers, and blogs must be arrays.');
  }

  const usersById = new Map(
    users.filter((user) => user.role === 'user' && user._id).map((user) => [String(user._id), user])
  );
  const blogsById = new Map(blogs.map((blog) => [blog.id, blog]));
  const seenUsers = new Set();
  const seenCustomerBlogs = new Set();
  const likedBlogs = [];

  for (const customerBlogs of likedBlogData.users) {
    const user = usersById.get(String(customerBlogs.userId));
    if (!user) {
      throw new Error(`Liked blogs do not reference an existing customer "${customerBlogs.userId}".`);
    }
    if (seenUsers.has(String(user._id))) {
      throw new Error(`Liked blogs contain duplicate user "${user._id}".`);
    }
    if (!Array.isArray(customerBlogs.blogIds)
      || customerBlogs.blogIds.length < 2
      || customerBlogs.blogIds.length > 12) {
      throw new Error(`Customer "${user._id}" must have 2-12 liked blogs.`);
    }

    seenUsers.add(String(user._id));
    const seenBlogIds = new Set();
    for (const blogId of customerBlogs.blogIds) {
      if (seenBlogIds.has(blogId)) {
        throw new Error(`Customer "${user._id}" has duplicate liked blog "${blogId}".`);
      }
      const blog = blogsById.get(blogId);
      if (!blog) {
        throw new Error(`Liked blog "${blogId}" does not exist in blogs.`);
      }

      seenBlogIds.add(blogId);
      const customerBlog = `${String(user._id)}:${blogId}`;
      if (seenCustomerBlogs.has(customerBlog)) {
        throw new Error(`Customer "${user._id}" has duplicate liked blog "${blogId}".`);
      }
      seenCustomerBlogs.add(customerBlog);
      likedBlogs.push({
        id: `liked-blog-${String(user._id)}-${blogId}`,
        userId: user._id,
        blogId: blog.id,
        liked: true
      });
    }
  }

  if (seenUsers.size !== usersById.size) {
    throw new Error('Every customer must have liked-blog records.');
  }
  return likedBlogs;
}

module.exports = { prepareLikedBlogs };
