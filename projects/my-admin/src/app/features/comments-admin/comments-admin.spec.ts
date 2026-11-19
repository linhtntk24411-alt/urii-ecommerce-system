import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError, TimeoutError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CommentsAdmin } from './comments-admin';
import { AdminApiService } from '../../core/services/admin-api.service';

describe('CommentsAdmin', () => {
  let component: CommentsAdmin;
  let fixture: ComponentFixture<CommentsAdmin>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let getCommentById: ReturnType<typeof vi.fn>;
  let scroll: ReturnType<typeof vi.fn>;
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const mongoComments = [{
    id: 17,
    blogId: 4,
    author: 'Nguyễn Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    content: 'Bình luận từ MongoDB',
    time: '1 giờ trước'
  }];

  beforeEach(async () => {
    scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    params = new BehaviorSubject(convertToParamMap({}));
    getCommentById = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CommentsAdmin],
      providers: [{
        provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() }
      }, {
        provide: AdminApiService,
        useValue: {
          getComments: () => of(mongoComments),
          getAdminReviews: () => of([]),
          getCommentById,
          getLibraryMapImageUrl: (path: string) => `http://localhost:3002/${path}`
        }
      }]
    }).compileComponents();

    fixture = TestBed.createComponent(CommentsAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  async function navigateToComment(id: string, click: string) {
    params.next(convertToParamMap({ searchType: 'comment', searchId: id, notificationClick: click }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load MongoDB comments as blog comments', () => {
    expect(component.totalCount).toBe(1);
    expect(component.allComments[0]).toMatchObject({
      id: '17',
      content: 'Bình luận từ MongoDB',
      targetName: 'Bài viết #4',
      targetType: 'blog',
      authorName: 'Nguyễn Minh Anh',
      authorAvatar: 'images/avatar_user.jpeg',
      date: '1 giờ trước',
      status: 'normal',
      rating: undefined,
      replyStatus: 'unanswered'
    });

    fixture.detectChanges();
    const avatar = fixture.nativeElement.querySelector(
      '.table-comments .author-avatar'
    ) as HTMLImageElement;
    expect(avatar.src).toBe('http://localhost:3002/images/avatar_user.jpeg');
  });

  it('should stop loading and show a useful message when the request times out', () => {
    TestBed.inject(AdminApiService).getComments = () => throwError(() => new TimeoutError());

    component.loadComments();

    expect(component.isLoading).toBe(false);
    expect(component.commentsLoadError).toContain('sau 8 giây');
  });

  it('locates an initial notification after rendering', async () => {
    fixture.destroy();
    params.next(convertToParamMap({ searchType: 'comment', searchId: '17', notificationClick: '1' }));
    fixture = TestBed.createComponent(CommentsAdmin);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(getCommentById).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#admin-search-target-comment-17 td').style.backgroundColor).not.toBe('');
  });

  it('loads and highlights an off-list comment, then locates it again without another request', async () => {
    getCommentById.mockReturnValue(of({ ...mongoComments[0], id: 299, content: 'Ngoài danh sách' }));
    await navigateToComment('299', '1');
    await navigateToComment('299', '2');
    expect(getCommentById).toHaveBeenCalledExactlyOnceWith('299');
    expect(component.allComments.map(item => item.id)).toEqual(['17', '299']);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('#admin-search-target-comment-299').textContent).toContain('Ngoài danh sách');
  });

  it('renders the page containing the matched comment before scrolling', async () => {
    TestBed.inject(AdminApiService).getComments = () => of(Array.from({ length: 6 }, (_, index) => ({
      ...mongoComments[0], id: index + 1,
    })));
    component.loadComments();
    await navigateToComment('6', '1');
    expect(component.currentBlogPage).toBe(2);
    expect(fixture.nativeElement.querySelector('#admin-search-target-comment-6')).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it.each([404, 500])('reports lookup errors %s and preserves the current list', async status => {
    getCommentById.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    await navigateToComment('299', '1');
    expect(component.targetError).toContain(status === 404 ? 'đã bị xóa' : 'Vui lòng thử lại');
    expect(component.allComments).toHaveLength(1);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('keeps review targets separate from the blog comment endpoint', async () => {
    await navigateToComment('review:299', '1');
    expect(getCommentById).not.toHaveBeenCalled();
  });
});
