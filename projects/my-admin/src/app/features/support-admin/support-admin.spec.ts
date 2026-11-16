import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportAdmin } from './support-admin';
import { signal } from '@angular/core';
import { afterEach, vi } from 'vitest';
import { AdminApiService } from '../../core/services/admin-api.service';

describe('SupportAdmin', () => {
  let component: SupportAdmin;
  let fixture: ComponentFixture<SupportAdmin>;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessions: [] }))));
    await TestBed.configureTestingModule({
      imports: [SupportAdmin],
      providers: [{ provide: AdminApiService, useValue: { token: signal('admin-jwt'), getLibraryMapImageUrl: (path: string) => '/api/' + path } }],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportAdmin);
    component = fixture.componentInstance;
  });

  afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows reaction controls only for server-confirmed messages and keeps the existing composer', () => {
    const old = { text: 'Old local message', sender: 'user', timestamp: 1 };
    const confirmed = { text: 'New message', sender: 'admin', timestamp: 1, messageId: 'server-message' };
    component.sessions = { room: { sessionId: 'room', userName: 'Customer', status: 'active', messages: [old, confirmed] } };
    component.selectedSessionId = 'room';
    component.reactionState = { 'server-message': [{ actor: 'user', emoji: '❤️' }] };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.reaction-trigger').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.reaction-badge').textContent).toContain('❤️');
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Old local message');
  });

  it('opens the picker on click/touch and closes it with Escape', () => {
    const message = { text: 'Hello', sender: 'user', messageId: 'server-message', timestamp: 1 };
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [message] } };
    component.selectedSessionId = 'room'; component.reactionState = { 'server-message': [] };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.reaction-trigger').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.reaction-picker button').length).toBe(6);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.reaction-picker')).toBeNull();
  });

  it('removes only its own repeated emoji without writing reactions to localStorage', async () => {
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    component.reactionState = { message: [{ actor: 'account:admin', emoji: '❤️' }, { actor: 'guest:user', emoji: '👍' }] };
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ messageId: 'message', reactions: [{ actor: 'guest:user', emoji: '👍' }] })));
    await component.react({ messageId: 'message' }, '❤️', new Event('click'));
    const options = fetchMock.mock.calls.at(-1)![1]!;
    expect(JSON.parse(options.body as string)).toEqual({ emoji: null });
    expect(component.reactionState['message']).toEqual([{ actor: 'guest:user', emoji: '👍' }]);
    expect(write).not.toHaveBeenCalled();
  });

  it('reloads server reactions even if the number of messages is unchanged', async () => {
    component.selectedSessionId = 'room'; component.reactionState = { message: [] };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ actor: 'account:admin', reactions: { message: [{ actor: 'guest:user', emoji: '😂' }] } })));
    await component.loadReactions();
    expect(component.reactionState['message'][0].emoji).toBe('😂');
  });

  it('preserves old local history and joins new server messages by request ID only', async () => {
    const old = { text: 'Same text', sender: 'admin', timestamp: 1 };
    const pending = { text: 'Same text', sender: 'admin', timestamp: 1, clientRequestId: 'request' };
    component.sessions = { room: { sessionId: 'room', messages: [old, pending] } };
    localStorage.setItem('urii_chat_sessions', JSON.stringify(component.sessions));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [{ sessionId: 'room', messages: [
      { text: 'Same text', sender: 'admin', timestamp: 999, clientRequestId: 'request', messageId: 'server-id', senderId: 'account:admin' }
    ] }] })));
    component.loadSessions();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.sessions['room'].messages.length).toBe(2);
    expect(component.sessions['room'].messages[0]).toEqual(old);
    expect(component.sessions['room'].messages[1].messageId).toBe('server-id');
    expect(component.sessions['room'].messages[1].timestamp).toBe(1);
  });

  it('recall: masks cached server messages and previews before the server verifies them', () => {
    const message = { messageId: 'message', sender: 'admin', senderId: 'account:admin', text: 'Cached secret', timestamp: 1 };
    component.sessions = { room: { sessionId: 'room', userName: 'Customer', status: 'active', messages: [message] } };
    component.selectedSessionId = 'room';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cached secret');
    expect(fixture.nativeElement.textContent).toContain('Đang xác minh tin nhắn');
    expect(component.getLastMessage(component.sessions['room'])).not.toContain('Cached secret');
    expect(fixture.nativeElement.querySelector('.recall-trigger')).toBeNull();
  });

  it('recall: the menu is available only for the verified original administrator', () => {
    const mine = { messageId: 'mine', sender: 'admin', senderId: 'account:admin', text: 'Mine', timestamp: 1 };
    const other = { messageId: 'other', sender: 'admin', senderId: 'account:other', text: 'Other', timestamp: 2 };
    const user = { messageId: 'user', sender: 'user', senderId: 'account:user', text: 'User', timestamp: 3 };
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [mine, other, user] } };
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    component.reactionState = { mine: [], other: [], user: [] };
    (component as any).rememberMessages('room', [mine, other, user]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.recall-trigger').length).toBe(1);
    fixture.nativeElement.querySelector('.recall-trigger').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.recall-menu').textContent).toContain('Thu hồi tin nhắn');
    expect(component.canRecall(other)).toBe(false); expect(component.canRecall(user)).toBe(false);
  });

  it('recall: canceling confirmation does not call the API', async () => {
    const message = { messageId: 'message', sender: 'admin', senderId: 'account:admin', text: 'Mine' };
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    (component as any).rememberMessages('room', [message]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const calls = vi.mocked(fetch).mock.calls.length;
    await component.recall(message, new Event('click'));
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(component.messageText(message)).toBe('Mine');
  });

  it('recall: confirmation hides text and reactions without rewriting local history', async () => {
    const message = { messageId: 'message', sender: 'admin', senderId: 'account:admin', text: 'Cached secret', timestamp: 1 };
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    component.reactionState = { message: [{ actor: 'account:user', emoji: '❤️' }], other: [{ actor: 'account:user', emoji: '👍' }] };
    (component as any).rememberMessages('room', [message]);
    const cache = JSON.stringify({ room: { sessionId: 'room', messages: [message] } });
    localStorage.setItem('urii_chat_sessions', cache);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: { ...message, text: 'Tin nhắn đã được thu hồi', recalledAt: 123, recalledBy: 'account:admin' } })));
    await component.recall(message, new Event('click'));
    expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toBe('/api/chat/sessions/room/messages/message/recall');
    expect(component.messageText(message)).toBe('Tin nhắn đã được thu hồi');
    expect(component.canReact(message)).toBe(false); expect(component.canRecall(message)).toBe(false);
    expect(component.reactionState['other'][0].emoji).toBe('👍');
    expect(localStorage.getItem('urii_chat_sessions')).toBe(cache);
    (component as any).rememberMessages('room', [message]);
    expect(component.messageText(message)).toBe('Tin nhắn đã được thu hồi');
  });

  it('recall: a remote user recall is reflected on polling, including after reload', async () => {
    const cached = { messageId: 'message', sender: 'user', senderId: 'account:user', text: 'Old user secret', timestamp: 1 };
    component.selectedSessionId = 'room';
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [cached] } };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ actor: 'account:admin', reactions: { message: [] }, messages: [
      { ...cached, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }
    ] })));
    await component.loadReactions();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Old user secret');
    expect(fixture.nativeElement.textContent).toContain('Tin nhắn đã được thu hồi');
    expect(fixture.nativeElement.querySelector('.reaction-badge')).toBeNull();
    const reloaded = TestBed.createComponent(SupportAdmin);
    reloaded.componentInstance.selectedSessionId = 'room';
    expect(reloaded.componentInstance.messageText(cached)).toContain('Đang xác minh');
    reloaded.destroy();
  });

  it('recall: switching conversations invalidates active cached content until verified', async () => {
    const message = { messageId: 'message', sender: 'admin', text: 'Cached secret' };
    component.sessions = { first: { sessionId: 'first', messages: [] }, second: { sessionId: 'second', messages: [message] } };
    component.selectedSessionId = 'first';
    (component as any).rememberMessages('second', [message]);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.selectSession('second');
    expect(component.messageText(message)).toContain('Đang xác minh');
    finish(new Response(JSON.stringify({ actor: 'account:admin', reactions: { message: [] }, messages: [{ ...message, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }] })));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.messageText(message)).toBe('Tin nhắn đã được thu hồi');
  });

  it('forward: inserts the icon between reaction and more only for a verified valid source', () => {
    const mine = { messageId: 'mine', sender: 'admin', senderId: 'account:admin', text: 'Mine', timestamp: 1 };
    component.selectedSessionId = 'source'; component.reactionActor = 'account:admin';
    component.sessions = { source: { sessionId: 'source', status: 'active', messages: [mine] } };
    component.reactionState = { mine: [] }; (component as any).rememberMessages('source', [mine]);
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelector('.reaction-toolbar').children].map((button: any) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Thả cảm xúc', 'Chuyển tiếp tin nhắn', 'Tùy chọn tin nhắn']);
    expect(component.canForward({ text: 'Local only' })).toBe(false);
    (component as any).rememberMessages('source', [{ ...mine, recalledAt: 123 }]);
    expect(component.canForward(mine)).toBe(false);
  });

  it('forward: loads and searches real server destinations, excludes the source and supports cancel', async () => {
    const message = { messageId: 'user-message', sender: 'user', text: 'Question' };
    component.selectedSessionId = 'source'; (component as any).rememberMessages('source', [message]);
    component.sessions = { fakeCache: { sessionId: 'fakeCache', userName: 'Not from server' } };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [
      { sessionId: 'source', userName: 'Source' }, { sessionId: 'alice', userName: 'Alice', userEmail: 'alice@example.test' }, { sessionId: 'bob', userName: 'Bob', userEmail: 'bob@example.test' }
    ] })));
    await component.openForward(message, new Event('click'));
    expect(component.forwardTargets.map(s => s.sessionId)).toEqual(['alice', 'bob']);
    component.forwardSearch = 'BOB@'; expect(component.getForwardTargets().map(s => s.sessionId)).toEqual(['bob']);
    component.forwardTargetId = 'bob'; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]').textContent).toContain('✓ Đã chọn');
    component.cancelForward();
    const calls = vi.mocked(fetch).mock.calls.length;
    await component.forward(); expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(component.selectedSessionId).toBe('source');
  });

  it('forward: prevents double submits and leaves the open source conversation unchanged', async () => {
    component.selectedSessionId = 'source';
    component.forwardSource = { sessionId: 'source', messageId: 'message', requestId: 'request-1111111111111111' };
    component.forwardTargetId = 'target'; component.forwardTargets = [{ sessionId: 'target', userName: 'Target', userEmail: '' }];
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = component.forward(); await component.forward();
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    finish(new Response(JSON.stringify({ message: { messageId: 'copy', text: 'Copied', sender: 'admin', senderId: 'account:admin', forwarded: true } })));
    await first;
    expect(component.selectedSessionId).toBe('source'); expect(component.forwardSource).toBeNull();
    expect(component.forwardNotice).toContain('Target');
  });

  it('forward: retry keeps the same request ID and sends no client-supplied content or sender', async () => {
    const source = { sessionId: 'source', messageId: 'message', requestId: 'request-1111111111111111' };
    component.forwardSource = source; component.forwardTargetId = 'target';
    component.forwardTargets = [{ sessionId: 'target', userName: 'Target', userEmail: '' }];
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Transaction failed' }), { status: 503 }));
    await component.forward(); expect(component.forwardSource).toBe(source);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: { messageId: 'copy', text: 'Copied', sender: 'admin', forwarded: true }, duplicate: true })));
    await component.forward();
    const payloads = vi.mocked(fetch).mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(payloads).toEqual([
      { targetSessionId: 'target', clientRequestId: source.requestId }, { targetSessionId: 'target', clientRequestId: source.requestId }
    ]);
  });

  it('sticker: picker sends separately, preserves draft and suppresses repeated clicks', async () => {
    component.selectedSessionId = 'room'; component.adminReplyText = 'Draft stays here';
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [] } };
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    vi.spyOn(component, 'loadReactions').mockResolvedValue();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.sticker-toggle').click(); fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.sticker-picker button');
    expect(Array.from(buttons, (button: any) => button.textContent.trim())).toEqual(['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋']);
    buttons[0].click(); component.sendAdminMessage('🥰');
    expect(fetch).toHaveBeenCalledTimes(1);
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    const payload = JSON.parse(options.body as string);
    expect(payload).toMatchObject({ text: '🥰', type: 'sticker', sender: 'admin' });
    expect((options.headers as any).Authorization).toBe('Bearer admin-jwt');
    expect(component.adminReplyText).toBe('Draft stays here');
    expect(component.sessions['room'].messages.length).toBe(1);
    resolve(new Response(JSON.stringify({ acceptedMessage: { ...payload, messageId: 'sticker', senderId: 'account:admin' } })));
    await vi.waitFor(() => expect(component.stickerBusy).toBe(false));
    expect(component.sessions['room'].messages[0].messageId).toBe('sticker');
    expect(component.isStickerPickerOpen).toBe(false);
    const cached = localStorage.getItem('urii_chat_sessions')!;
    expect(cached).not.toContain('🥰'); expect(cached).not.toContain('"type":"sticker"');
    expect(component.adminReplyText).toBe('Draft stays here');
  });

  it('sticker: a failed send retries the same key without duplicating the local message', async () => {
    component.selectedSessionId = 'room'; component.adminReplyText = 'Draft';
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [] } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    vi.spyOn(component, 'loadReactions').mockResolvedValue();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Retry' }), { status: 503 }));
    component.sendAdminMessage('👋'); await vi.waitFor(() => expect(component.stickerBusy).toBe(false));
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ acceptedMessage: { ...first, messageId: 'sticker', senderId: 'account:admin' } })));
    component.sendAdminMessage('👋'); await vi.waitFor(() => expect(component.stickerBusy).toBe(false));
    const second = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(second).toEqual(first); expect(component.sessions['room'].messages.length).toBe(1);
    expect(component.adminReplyText).toBe('Draft');
  });

  it('sticker: server verification controls rendering, forwarding, recall and cache reload', () => {
    const sticker = { messageId: 'sticker', sender: 'admin', senderId: 'account:admin', type: 'sticker', text: '🥰', timestamp: 1 };
    const plain = { messageId: 'plain', sender: 'user', text: '👍', timestamp: 2 };
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [sticker, plain] } };
    component.reactionState = { sticker: [{ actor: 'guest:user', emoji: '❤️' }], plain: [] };
    expect(component.isSticker(sticker)).toBe(false);
    expect(component.messageText(sticker)).toContain('Đang xác minh');
    (component as any).rememberMessages('room', [sticker, plain]);
    expect(component.canForward(sticker)).toBe(false); expect(component.canForward(plain)).toBe(true);
    expect(component.canRecall(sticker)).toBe(true); expect(component.canReact(sticker)).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.sticker-icon').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.sticker-icon').textContent).toContain('🥰');
    component.saveSessions();
    (component as any).rememberMessages('room', [{ ...sticker, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }]);
    (component as any).rememberMessages('room', [sticker]);
    (component as any).cdr.markForCheck(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sticker-icon')).toBeNull();
    expect(fixture.nativeElement.querySelector('.reaction-badge')).toBeNull();
    expect(component.messageText(sticker)).toBe('Tin nhắn đã được thu hồi');
    const reloaded = TestBed.createComponent(SupportAdmin);
    reloaded.componentInstance.selectedSessionId = 'room';
    expect(reloaded.componentInstance.isSticker(sticker)).toBe(false);
    expect(reloaded.componentInstance.messageText(sticker)).toContain('Đang xác minh');
    reloaded.destroy();
  });

  it('forward: the label is rendered only for verified active copies', () => {
    const copy = { messageId: 'copy', text: 'Copied', sender: 'admin', forwarded: true, timestamp: 1 };
    component.selectedSessionId = 'target';
    component.sessions = { target: { sessionId: 'target', status: 'active', messages: [copy] } };
    expect(component.isForwarded(copy)).toBe(false);
    (component as any).rememberMessages('target', [copy]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.forwarded-label').textContent).toBe('Đã chuyển tiếp');
    (component as any).rememberMessages('target', [{ ...copy, recalledAt: 123 }]);
    expect(component.isForwarded(copy)).toBe(false);
  });

  it('attachment: the plus menu previews locally and cancellation preserves the draft without uploading', () => {
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static override createObjectURL = vi.fn(() => 'blob:preview'); static override revokeObjectURL = vi.fn(); });
    component.selectedSessionId = 'room'; component.sessions = { room: { sessionId: 'room', status: 'active', messages: [] } };
    component.adminReplyText = 'Keep draft'; fixture.detectChanges();
    fixture.nativeElement.querySelector('.attachment-toggle').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-menu').textContent).toContain('Gửi ảnh');
    expect(fixture.nativeElement.querySelector('.attachment-menu').textContent).toContain('Gửi file');
    component.attachmentKind = 'image';
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    component.pickAttachment({ target: { files: [file] } } as unknown as Event);
    expect(component.selectedAttachment).toBe(file); expect(component.attachmentPreview).toBe('blob:preview');
    expect(fetch).not.toHaveBeenCalled(); component.cancelAttachment();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview'); expect(component.selectedAttachment).toBeNull();
    expect(component.adminReplyText).toBe('Keep draft');
    component.pickAttachment({ target: { files: [new File(['bad'], 'bad.exe')] } } as unknown as Event);
    expect(component.selectedAttachment).toBeNull(); expect(component.attachmentError).toBeTruthy();
  });

  it('attachment: confirmation sends once, retry keeps its key and preserves the text composer', async () => {
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {}); vi.spyOn(component, 'loadReactions').mockResolvedValue();
    component.selectedSessionId = 'room'; component.sessions = { room: { sessionId: 'room', status: 'active', messages: [] } };
    component.adminReplyText = 'Keep draft'; component.attachmentKind = 'file';
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    component.pickAttachment({ target: { files: [file] } } as unknown as Event);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Retry' }), { status: 503 }));
    await component.sendAttachment(); expect(component.selectedAttachment).toBe(file);
    const firstHeaders = vi.mocked(fetch).mock.calls[0][1]!.headers as Record<string, string>;
    const message = { messageId: 'file', clientRequestId: firstHeaders['X-Client-Request-Id'], senderId: 'account:admin', sender: 'admin', type: 'file', text: '[File đính kèm]', attachment: { name: 'a.txt', mime: 'text/plain', size: 5 }, timestamp: 1 };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ acceptedMessage: message })));
    const pending = component.sendAttachment(); await component.sendAttachment(); await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((vi.mocked(fetch).mock.calls[1][1]!.headers as any)['X-Client-Request-Id']).toBe(firstHeaders['X-Client-Request-Id']);
    expect(vi.mocked(fetch).mock.calls[1][1]!.body).toBe(file);
    expect(component.adminReplyText).toBe('Keep draft'); expect(component.selectedAttachment).toBeNull();
    expect(component.sessions['room'].messages.length).toBe(1); expect(component.attachment(message).name).toBe('a.txt');
    expect(component.canForward(message)).toBe(false);
    expect(localStorage.getItem('urii_chat_sessions')).not.toContain('a.txt');
  });

  it('attachment: server verification gates file display, and recall removes metadata and download controls', () => {
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    const message = { messageId: 'file', sender: 'admin', senderId: 'account:admin', type: 'file', text: '[File đính kèm]', attachment: { name: 'private.pdf', mime: 'application/pdf', size: 123 }, timestamp: 1 };
    component.selectedSessionId = 'room'; component.reactionActor = 'account:admin';
    component.sessions = { room: { sessionId: 'room', status: 'active', messages: [message] } }; component.reactionState = { file: [] };
    expect(component.attachment(message)).toBeNull();
    (component as any).rememberMessages('room', [message]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-file-button').textContent).toContain('private.pdf');
    expect(component.canRecall(message)).toBe(true); expect(component.canReact(message)).toBe(true);
    (component as any).rememberMessages('room', [{ ...message, text: 'Tin nhắn đã được thu hồi', recalledAt: 1 }]);
    (component as any).rememberMessages('room', [message]); (component as any).cdr.markForCheck(); fixture.detectChanges();
    expect(component.attachment(message)).toBeNull(); expect(fixture.nativeElement.querySelector('.chat-file-button')).toBeNull();
    expect(component.messageText(message)).toBe('Tin nhắn đã được thu hồi'); expect(component.canReact(message)).toBe(false);
  });

  it('attachment: image thumbnails use authenticated binary reads and recall closes the large image', async () => {
    vi.spyOn(component, 'loadSessions').mockImplementation(() => {});
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static override createObjectURL = vi.fn(() => 'blob:private-image'); static override revokeObjectURL = vi.fn(); });
    const message = { messageId: 'image', type: 'image', sender: 'user', text: '[Ảnh]', timestamp: 1, attachment: { name: 'a.png', mime: 'image/png', size: 12 } };
    component.selectedSessionId = 'room'; component.sessions = { room: { sessionId: 'room', status: 'active', messages: [message] } };
    (component as any).rememberMessages('room', [message]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('image', { headers: { 'Content-Type': 'image/png' } }));
    fixture.detectChanges();
    await vi.waitFor(() => expect((component as any).attachmentUrls.size).toBe(1)); fixture.detectChanges();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/chat/sessions/room/messages/image/attachment');
    expect((vi.mocked(fetch).mock.calls[0][1]!.headers as any).Authorization).toBe('Bearer admin-jwt');
    expect(fixture.nativeElement.querySelector('.chat-attachment-image').getAttribute('src')).toBe('blob:private-image');
    fixture.nativeElement.querySelector('.chat-image-button').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-lightbox')).not.toBeNull();
    (component as any).rememberMessages('room', [{ ...message, recalledAt: 123 }]);
    (component as any).cdr.markForCheck(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-lightbox')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chat-attachment-image')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-image');
  });
});
