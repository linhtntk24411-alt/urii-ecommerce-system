import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY, expand, map, Observable, toArray } from 'rxjs';

export interface BlogPost {
  id: string | number;
  slug: string;
  title: string;
  summary: string;
  excerpt: string;
  content: string;
  author: string;
  avatar: string;
  date: string;
  image: string;
  userId?: string;
  imageAvailable?: boolean;
  category: string;
  categorySlug: string;
  likes: number;
  comments: number;
  views: number;
  isFeatured: boolean;
  tags: string[];
}

export interface BlogCommentReply {
  id: string;
  author: string;
  avatar: string;
  content: string;
  createdAt?: string;
  time?: string;
  role?: 'user' | 'admin' | 'author';
  replyTo?: string;
  replyToAuthor?: string;
}

export interface BlogComment {
  id: string | number;
  blogId: string | number;
  author: string;
  avatar: string;
  content: string;
  createdAt: string;
  time: string;
  replies?: BlogCommentReply[];
}

export interface NewBlogPost {
  title: string;
  slug?: string;
  excerpt: string;
  content: string;
  image?: string;
  author?: string;
  avatar?: string;
  date?: string;
  category: string;
  categorySlug: string;
  tags: string[];
}

@Injectable({ providedIn: 'root' })
export class BlogService {
  private readonly http = inject(HttpClient);

  createBlog(post: NewBlogPost, token: string): Observable<BlogPost> {
    return this.http.post<unknown>('/api/blogs', post, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).pipe(
      map((response) => {
        const createdPost = this.parseBlogs(response)[0];
        if (!createdPost) throw new Error('API táº¡o bĂ i viáº¿t tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡.');
        return createdPost;
      }),
    );
  }

  replyComment(commentId: string | number, content: string, token: string, replyToAuthor?: string): Observable<any> {
    return this.http.post<any>(`/api/comments/${commentId}/replies`, { content, replyToAuthor }, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    });
  }

  createComment(comment: Pick<BlogComment, 'blogId' | 'content'>, token: string): Observable<BlogComment> {
    return this.http.post<unknown>('/api/comments', comment, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).pipe(
      map((response) => {
        const createdComment = this.parseComments(response)[0];
        if (!createdComment) throw new Error('API táº¡o bĂ¬nh luáº­n tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡.');
        return createdComment;
      }),
    );
  }

  getBlogComments(blogId: string | number): Observable<BlogComment[]> {
    return this.loadCommentsPage(1).pipe(
      expand((comments, pageIndex) =>
        comments.length === 100 ? this.loadCommentsPage(pageIndex + 2) : EMPTY,
      ),
      toArray(),
      map((pages) => pages.flat().filter(
        (comment) => String(comment.blogId) === String(blogId),
      )),
    );
  }

  getBlogs(): Observable<BlogPost[]> {
    return this.http.get<unknown>('/api/blogs').pipe(
      map((response) => this.parseBlogs(response)),
    );
  }

  getBlogsByUser(token: string, userId: string): Observable<BlogPost[]> {
    return this.loadBlogsPage(1, token).pipe(
      expand((blogs, pageIndex) =>
        blogs.length === 100 ? this.loadBlogsPage(pageIndex + 2, token) : EMPTY,
      ),
      toArray(),
      map((pages) => pages.flat().filter((blog) => blog.userId === userId)),
    );
  }

  deleteBlog(id: string | number, token: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`/api/blogs/${encodeURIComponent(id)}`, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    });
  }

  getBlogBySlug(slug: string): Observable<BlogPost | undefined> {
    return this.getBlogs().pipe(
      map((blogs) => blogs.find((blog) => blog.slug === slug)),
    );
  }

  private parseBlogs(response: unknown): BlogPost[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response)
        ? [response['blogs'], response['data']].find(Array.isArray) ?? [response]
        : [];

    return records.flatMap((record): BlogPost[] => {
      if (!this.isRecord(record)) return [];

      const title = this.toText(record['title']);
      if (!title) return [];

      const slug = this.toText(record['slug']) || this.slugify(title);
      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : slug;
      const rawUserId = record['userId'];
      const userId = typeof rawUserId === 'string'
        ? rawUserId
        : this.isRecord(rawUserId) && typeof rawUserId['$oid'] === 'string'
          ? rawUserId['$oid']
          : '';
      const categoryValue = record['category'];
      const category = this.isRecord(categoryValue)
        ? this.toText(categoryValue['name'] ?? categoryValue['title'])
        : this.toText(categoryValue);
      const summary = this.toText(record['summary'] ?? record['excerpt']);
      const date = this.toText(record['date'] ?? record['createdAt'] ?? record['updatedAt']);
      const rawImage = record['image'] ?? record['coverImage'];

      return [{
        id,
        slug,
        ...(userId ? { userId } : {}),
        title,
        summary,
        excerpt: this.toText(record['excerpt'] ?? record['summary']),
        content: this.normalizeContent(record['content']),
        author: this.toText(record['author']) || 'Urii',
        avatar: this.normalizeImagePath(record['avatar']) || 'assets/gallery_assets/mau-ca-heo.webp',
        date,
        image: this.normalizeImagePath(rawImage) || 'assets/gallery_assets/mau-ca-heo.webp',
        imageAvailable: typeof rawImage === 'string' && Boolean(rawImage.trim()),
        category: category || 'KhĂ¡c',
        categorySlug: this.toText(record['categorySlug'] ?? record['category_slug']) || this.slugify(category || 'KhĂ¡c'),
        likes: this.toNumber(record['likes']),
        comments: this.toNumber(record['comments']),
        views: this.toNumber(record['views']),
        isFeatured: record['isFeatured'] === true || record['is_featured'] === true,
        tags: this.toStringArray(record['tags']),
      }];
    });
  }

  private parseComments(response: unknown): BlogComment[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response) && Array.isArray(response['comments'])
        ? response['comments']
        : this.isRecord(response)
          ? [response]
          : [];

    return records.flatMap((record): BlogComment[] => {
      if (!this.isRecord(record)) return [];

      const content = this.toText(record['content']);
      if (!content) return [];

      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : '';
      const rawBlogId = record['blogId'] ?? record['blog_id'];
      const blogId = typeof rawBlogId === 'string' || typeof rawBlogId === 'number'
        ? rawBlogId
        : '';
      const createdAtValue = record['createdAt'] ?? record['updatedAt'];
      const createdAt = createdAtValue instanceof Date
        ? createdAtValue.toISOString()
        : this.toText(createdAtValue);
      const avatar = this.normalizeImagePath(record['avatar']);

      const rawReplies = Array.isArray(record['replies']) ? record['replies'] : [];
      const replies: BlogCommentReply[] = rawReplies.flatMap((r): BlogCommentReply[] => {
        if (!this.isRecord(r)) return [];
        const replyContent = this.toText(r['content']);
        if (!replyContent) return [];
        return [{
          id: this.toText(r['id']) || String(Date.now()),
          author: this.toText(r['author']) || 'KhĂ¡ch hĂ ng',
          avatar: this.normalizeImagePath(r['avatar']) || 'assets/avatar-non.jpg',
          content: replyContent,
          createdAt: this.toText(r['createdAt']),
          time: this.toText(r['time']) || 'Vá»«a xong',
          role: (r['role'] as any) || 'user',
          replyToAuthor: this.toText(r['replyToAuthor']) || undefined
        }];
      });

      return [{
        id: id || `${blogId}-${createdAt}-${content.slice(0, 20)}`,
        blogId,
        author: this.toText(record['author']) || 'KhĂ¡ch hĂ ng',
        avatar: avatar || 'assets/avatar-non.jpg',
        content,
        createdAt,
        time: this.toText(record['time']),
        replies
      }];
    });
  }

  getMyLikedBlogs(token: string): Observable<string[]> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get<any>('/api/liked-blogs/mine', { headers }).pipe(
      map(res => {
        const list = Array.isArray(res) ? res : res?.likedBlogs || [];
        return list.map((item: any) => String(item.blogId || item.id || item._id || '')).filter(Boolean);
      })
    );
  }

  addLikedBlog(blogId: string | number, token: string): Observable<any> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.post('/api/liked-blogs/mine', { blogId: String(blogId) }, { headers });
  }

  removeLikedBlog(blogId: string | number, token: string): Observable<any> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.delete(`/api/liked-blogs/mine/${encodeURIComponent(String(blogId))}`, { headers });
  }

  private loadCommentsPage(page: number): Observable<BlogComment[]> {
    return this.http.get<unknown>('/api/comments', {
      params: { page, limit: 100 },
    }).pipe(map((response) => this.parseComments(response)));
  }

  private loadBlogsPage(page: number, token: string): Observable<BlogPost[]> {
    return this.http.get<unknown>('/api/blogs', {
      params: { page, limit: 100 },
      headers: new HttpHeaders({ Authorization: 'Bearer ' + token }),
    }).pipe(map((response) => this.parseBlogs(response)));
  }

  private normalizeImagePath(value: unknown): string {
    const path = this.toText(value);
    if (path.startsWith('images/')) return `/api/images/${path.slice('images/'.length)}`;
    if (path.startsWith('/images/')) return `/api/images/${path.slice('/images/'.length)}`;
    return path;
  }

  private normalizeContent(value: unknown): string {
    return this.toText(value).replace(/(["'])\/?images\//g, '$1/api/images/');
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[Ä‘Ä]/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}