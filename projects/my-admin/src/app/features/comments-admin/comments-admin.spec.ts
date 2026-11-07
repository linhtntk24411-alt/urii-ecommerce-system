import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError, TimeoutError } from 'rxjs';
import { CommentsAdmin } from './comments-admin';
import { AdminApiService } from '../../core/services/admin-api.service';

describe('CommentsAdmin', () => {
  let component: CommentsAdmin;
  let fixture: ComponentFixture<CommentsAdmin>;
  const mongoComments = [{
    id: 17,
    blogId: 4,
    author: 'Nguyễn Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    content: 'Bình luận từ MongoDB',
    time: '1 giờ trước'
  }];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommentsAdmin],
      providers: [{
        provide: AdminApiService,
        useValue: {
          getComments: () => of(mongoComments),
          getLibraryMapImageUrl: (path: string) => `http://localhost:3002/${path}`
        }
      }]
    }).compileComponents();

    fixture = TestBed.createComponent(CommentsAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load MongoDB comments as blog comments', () => {
    expect(component.totalCount).toBe(1);
    expect(component.allComments[0]).toEqual({
      id: '17',
      content: 'Bình luận từ MongoDB',
      targetName: 'Bài viết #4',
      targetType: 'blog',
      authorName: 'Nguyễn Minh Anh',
      authorAvatar: 'images/avatar_user.jpeg',
      date: '1 giờ trước',
      status: 'approved'
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
});
