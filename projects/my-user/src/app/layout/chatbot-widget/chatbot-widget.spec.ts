import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ChatbotWidgetComponent } from './chatbot-widget';
import { PLATFORM_ID } from '@angular/core';
import { DialogService } from '../../core/services/dialog.service';

describe('ChatbotWidgetComponent', () => {
  let component: ChatbotWidgetComponent;
  let fixture: ComponentFixture<ChatbotWidgetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatbotWidgetComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: PLATFORM_ID, useValue: 'server' }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatbotWidgetComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    try { fixture.destroy(); TestBed.inject(HttpTestingController).verify(); }
    finally { TestBed.resetTestingModule(); vi.restoreAllMocks(); localStorage.clear(); }
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('merge: rejects older polling revisions and ignores stale responses after a confirmed mutation', async () => {
    (component as any).currentSessionId = 'room';
    const message = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Active', timestamp: 1 };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [message] } }));
    expect((component as any).acceptSnapshot('server-room', '2026-11-16T10:00:02Z')).toBe(true);
    expect((component as any).acceptSnapshot('server-room', '2026-11-16T10:00:01Z')).toBe(false);
    const pending = component.loadReactions();
    (component as any).rememberMessages('server-room', [{ ...message, recalledAt: 123 }]);
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'waiting', messages: [message], reactions: { mine: [] } });
    await pending;
    expect(component.messageText(message)).toBe('Tin nhắn đã được thu hồi');
    expect(JSON.parse(localStorage.getItem('urii_chat_sessions')!).room.status).toBe('active');
  });

  it('keeps legacy messages visible without reaction controls', () => {
    component.isChatOpen = true;
    component.messages = [{ text: 'Legacy local history', sender: 'user', timestamp: 1 }];
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Legacy local history');
    expect(fixture.nativeElement.querySelector('.reaction-trigger')).toBeNull();
  });

  it('loads reactions from the server after reload without changing local history', async () => {
    (component as any).currentSessionId = 'room';
    const history = JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [
      { text: 'Legacy', sender: 'user', timestamp: 1 },
      { text: 'Confirmed', sender: 'admin', timestamp: 1, messageId: 'message', serverSessionId: 'server-room' }
    ] } });
    localStorage.setItem('urii_chat_sessions', history);
    const pending = component.loadReactions();
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({
      actor: 'guest:user', status: 'active', reactions: { message: [{ actor: 'account:admin', emoji: '❤️' }] },
      messages: [{ text: 'Confirmed', sender: 'admin', timestamp: 1, messageId: 'message' }]
    });
    await pending;
    expect(component.reactionState['message'][0].emoji).toBe('❤️');
    expect(component.messages.length).toBe(2);
    expect(localStorage.getItem('urii_chat_sessions')).toBe(history);
  });

  it('stores new user messages by request ID without matching identical legacy text or timestamps', async () => {
    const actor = 'guest:user';
    (component as any).currentSessionId = 'room';
    (component as any).reactionSessions.set('guest:room', Promise.resolve({ serverId: 'server-room', actor }));
    const message = { text: 'Identical text', sender: 'user', timestamp: 1, clientRequestId: 'request-11111111111111' };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [
      { text: 'Identical text', sender: 'user', timestamp: 1 }, message
    ] } }));
    const pending = (component as any).persistUserMessage(message, 'room');
    await new Promise(resolve => setTimeout(resolve, 0));
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/chat/sessions/server-room/messages');
    expect(request.request.body.clientRequestId).toBe(message.clientRequestId);
    request.flush({ acceptedMessage: { messageId: 'server-id', clientRequestId: message.clientRequestId, senderId: actor } });
    await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor, status: 'active', reactions: { 'server-id': [] }, messages: [
      { ...message, senderId: actor, messageId: 'server-id' }
    ] });
    await pending;
    const stored = JSON.parse(localStorage.getItem('urii_chat_sessions')!).room.messages;
    expect(stored.length).toBe(2);
    expect(stored[0].messageId).toBeUndefined();
    expect(stored[1].messageId).toBe('server-id');
    expect(stored[1].reactions).toBeUndefined();
  });

  it('changes its reaction through the API without sending another actor identity', async () => {
    (component as any).currentSessionId = 'room'; component.reactionActor = 'guest:user';
    component.reactionState = { message: [{ actor: 'guest:user', emoji: '❤️' }] };
    const pending = component.react({ messageId: 'message', serverSessionId: 'server-room', text: 'Hello', sender: 'user', timestamp: 1 }, '😂', new Event('click'));
    const request = TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/messages/message/reaction');
    expect(request.request.body).toEqual({ emoji: '😂' });
    request.flush({ reactions: [{ actor: 'guest:user', emoji: '😂' }] });
    await pending;
    expect(component.reactionState['message'][0].emoji).toBe('😂');
    expect(localStorage.getItem('urii_chat_sessions')).toBeNull();
  });

  it('renders only reaction controls, with no forwarding or recall controls', () => {
    component.isChatOpen = true;
    component.messages = [{ messageId: 'message', serverSessionId: 'server-room', text: 'Hello', sender: 'user', timestamp: 1 }];
    component.reactionState = { message: [{ actor: 'account:admin', emoji: '👍' }] };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.reaction-badge').textContent).toContain('👍');
    fixture.nativeElement.querySelector('.reaction-trigger').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.reaction-picker button').length).toBe(6);
    expect(fixture.nativeElement.textContent).not.toContain('Thu hồi');
    expect(fixture.nativeElement.textContent).not.toContain('Chuyển tiếp');
  });

  it('recall: reload never renders cached content before verifying the server state', async () => {
    (component as any).currentSessionId = 'room'; component.isChatOpen = true;
    const cached = { messageId: 'message', serverSessionId: 'server-room', sender: 'admin', text: 'Cached admin secret', timestamp: 1 };
    const history = JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [cached] } });
    localStorage.setItem('urii_chat_sessions', history);
    component.loadChatHistory(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cached admin secret');
    expect(component.getSessionPreview(JSON.parse(history).room)).toContain('Đang xác minh');
    const request = TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions');
    request.flush({ actor: 'guest:user', status: 'active', reactions: { message: [] }, messages: [
      { ...cached, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }
    ] });
    await new Promise(resolve => setTimeout(resolve, 0)); fixture.detectChanges();
    expect(component.messages[0].text).toBe('Tin nhắn đã được thu hồi');
    expect(fixture.nativeElement.textContent).not.toContain('Cached admin secret');
    expect(component.getSessionPreview(JSON.parse(history).room)).toBe('Tin nhắn đã được thu hồi');
    expect(localStorage.getItem('urii_chat_sessions')).toBe(history);
  });

  it('recall: only the verified sender gets a menu, including guest identities', () => {
    component.isChatOpen = true; component.reactionActor = 'guest:user';
    const mine = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Mine', timestamp: 1 };
    const admin = { messageId: 'admin', serverSessionId: 'server-room', sender: 'admin' as const, senderId: 'account:admin', text: 'Other', timestamp: 2 };
    component.messages = [mine, admin]; component.reactionState = { mine: [], admin: [] };
    (component as any).rememberMessages('server-room', [mine, admin]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.recall-trigger').length).toBe(1);
    fixture.nativeElement.querySelector('.recall-trigger').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.recall-menu').textContent).toContain('Thu hồi tin nhắn');
    expect(component.canRecall(admin)).toBe(false);
  });

  it('recall: canceling the existing confirmation dialog makes no request', async () => {
    const mine = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Mine', timestamp: 1 };
    component.reactionActor = 'guest:user'; (component as any).rememberMessages('server-room', [mine]);
    vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(false);
    await component.recall(mine, new Event('click'));
    TestBed.inject(HttpTestingController).expectNone('/api/chat/sessions/server-room/messages/mine/recall');
    expect(component.messageText(mine)).toBe('Mine');
  });

  it('recall: confirmed recall hides the content and own reactions without changing other reactions or cache', async () => {
    (component as any).currentSessionId = 'room';
    const mine = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Private user text', timestamp: 1 };
    component.messages = [mine]; component.reactionActor = 'guest:user';
    component.reactionState = { mine: [{ actor: 'account:admin', emoji: '❤️' }], other: [{ actor: 'account:admin', emoji: '👍' }] };
    (component as any).rememberMessages('server-room', [mine]);
    const history = JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [mine] } });
    localStorage.setItem('urii_chat_sessions', history);
    vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
    const pending = component.recall(mine, new Event('click'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/messages/mine/recall');
    expect(request.request.body).toEqual({});
    request.flush({ message: { ...mine, text: 'Tin nhắn đã được thu hồi', recalledAt: 123, recalledBy: 'guest:user' } });
    await pending;
    expect(component.messages[0].text).toBe('Tin nhắn đã được thu hồi');
    expect(component.canReact(mine)).toBe(false); expect(component.canRecall(mine)).toBe(false);
    expect(component.reactionState['other'][0].emoji).toBe('👍');
    expect(localStorage.getItem('urii_chat_sessions')).toBe(history);
  });

  it('recall: stale polling and cached conversation switches cannot restore recalled content', async () => {
    (component as any).currentSessionId = 'other';
    const cached = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Private user text', timestamp: 1 };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [cached] } }));
    (component as any).rememberMessages('server-room', [{ ...cached, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }]);
    component.switchSession('room');
    expect(component.messages[0].text).toBe('Tin nhắn đã được thu hồi');
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', reactions: { mine: [{ actor: 'account:admin', emoji: '❤️' }] }, messages: [cached] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.messages[0].text).toBe('Tin nhắn đã được thu hồi');
    expect(component.reactionState['mine']).toEqual([]);
    expect(component.canReact(cached)).toBe(false);
  });

  it('recall: switching an active cached conversation hides it until the server responds', async () => {
    (component as any).currentSessionId = 'other';
    const cached = { messageId: 'mine', serverSessionId: 'server-room', sender: 'user' as const, senderId: 'guest:user', text: 'Private user text', timestamp: 1 };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [cached] } }));
    (component as any).rememberMessages('server-room', [cached]);
    component.switchSession('room');
    expect(component.messages[0].text).toContain('Đang xác minh');
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', reactions: { mine: [] }, messages: [{ ...cached, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.messages[0].text).toBe('Tin nhắn đã được thu hồi');
  });

  it('forward: destination polling shows the copied text and label without any forwarding control', async () => {
    (component as any).currentSessionId = 'room'; component.isChatOpen = true;
    const original = { messageId: 'existing', serverSessionId: 'target-room', sender: 'user', text: 'Original', timestamp: 1 };
    const copy = { messageId: 'copy', sender: 'admin', senderId: 'account:admin', forwarded: true, text: 'Forwarded answer', timestamp: 2 };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [original] } }));
    const pending = component.loadReactions();
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/target-room/reactions').flush({ actor: 'guest:user', status: 'active', reactions: { existing: [], copy: [] }, messages: [original, copy] });
    await pending; fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Forwarded answer');
    expect(fixture.nativeElement.textContent).toContain('Đã chuyển tiếp');
    expect(fixture.nativeElement.querySelector('.forward-trigger')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Chuyển tiếp tin nhắn"]')).toBeNull();
    expect(component.canRecall(component.messages[1])).toBe(false);
  });

  it('forward: reload verifies the server label and does not trust a cached forwarding flag', async () => {
    (component as any).currentSessionId = 'room';
    const copy = { messageId: 'copy', serverSessionId: 'target-room', sender: 'admin' as const, text: 'Copied answer', timestamp: 2, forwarded: true };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [copy] } }));
    expect(component.isForwarded(copy)).toBe(false);
    const pending = component.loadReactions();
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/target-room/reactions').flush({ actor: 'guest:user', status: 'active', reactions: { copy: [] }, messages: [copy] });
    await pending;
    expect(component.isForwarded(component.messages[0])).toBe(true);
    expect(component.messages[0].text).toBe('Copied answer');
  });

  it('sticker: sends separately, keeps the draft, prevents double sends and does not request AI', async () => {
    (component as any).currentSessionId = 'room';
    (component as any).reactionSessions.set('guest:room', Promise.resolve({ serverId: 'server-room', actor: 'guest:user' }));
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'ai', messages: [] } }));
    component.userMessageText = 'Bản nháp chưa gửi';
    component.isChatOpen = true;
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#btn-sticker').click(); fixture.detectChanges();
    expect(Array.from(fixture.nativeElement.querySelectorAll('.sticker-picker button'), (button: any) => button.textContent.trim())).toEqual(['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋']);
    const pending = component.sendSticker('🥰'); await component.sendSticker('🥰');
    await new Promise(resolve => setTimeout(resolve, 0));
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/chat/sessions/server-room/messages');
    expect(request.request.body).toMatchObject({ type: 'sticker', text: '🥰', sender: 'user' });
    const accepted = { ...request.request.body, messageId: 'sticker', senderId: 'guest:user', timestamp: 1 };
    request.flush({ acceptedMessage: accepted });
    await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'ai', reactions: { sticker: [] }, messages: [accepted] });
    await pending;
    fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
    expect(component.userMessageText).toBe('Bản nháp chưa gửi');
    expect(fixture.nativeElement.querySelector('#chat-input').value).toBe('Bản nháp chưa gửi');
    expect(fixture.nativeElement.querySelector('.sticker-icon').textContent).toContain('🥰');
    expect(component.isTyping).toBe(false);
    expect(component.isStickerPickerOpen).toBe(false);
    const cached = localStorage.getItem('urii_chat_sessions')!;
    expect(cached).not.toContain('🥰'); expect(cached).not.toContain('"type":"sticker"');
    expect(JSON.parse(cached).room.messages.length).toBe(1);
    expect(component.canReact(component.messages[0])).toBe(true);
    expect(component.canRecall(component.messages[0])).toBe(true);
    http.expectNone(req => /chatbot|chat\/message$/.test(req.url));
  });

  it('sticker: retries failures with the same request key and preserves its draft', async () => {
    (component as any).currentSessionId = 'room';
    (component as any).reactionSessions.set('guest:room', Promise.resolve({ serverId: 'server-room', actor: 'guest:user' }));
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [] } }));
    component.userMessageText = 'Keep draft';
    const http = TestBed.inject(HttpTestingController);
    let pending = component.sendSticker('👋'); await new Promise(resolve => setTimeout(resolve, 0));
    const first = http.expectOne('/api/chat/sessions/server-room/messages');
    const payload = first.request.body;
    first.flush({ message: 'Retry' }, { status: 503, statusText: 'Unavailable' }); await pending;
    expect(component.stickerError).toBeTruthy();
    pending = component.sendSticker('👋'); await new Promise(resolve => setTimeout(resolve, 0));
    const retry = http.expectOne('/api/chat/sessions/server-room/messages'); expect(retry.request.body).toEqual(payload);
    const accepted = { ...payload, messageId: 'sticker', senderId: 'guest:user', timestamp: 1 };
    retry.flush({ acceptedMessage: accepted }); await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', reactions: { sticker: [] }, messages: [accepted] });
    await pending;
    expect(component.messages.length).toBe(1); expect(component.userMessageText).toBe('Keep draft');
  });

  it('sticker: polling and reload restore server type, and recall never restores a cached icon', async () => {
    (component as any).currentSessionId = 'room'; component.isChatOpen = true;
    const cached = { messageId: 'sticker', serverSessionId: 'server-room', sender: 'admin' as const, text: '[Icon cảm xúc]', timestamp: 1 };
    const sticker = { ...cached, type: 'sticker', text: '🥹', senderId: 'account:admin' };
    const plain = { messageId: 'plain', sender: 'user', text: '👍', timestamp: 2 };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [cached] } }));
    expect(component.messageText(cached)).toContain('Đang xác minh'); expect(component.isSticker(cached)).toBe(false);
    const pending = component.loadReactions();
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', messages: [sticker, plain], reactions: { sticker: [{ actor: 'guest:user', emoji: '❤️' }], plain: [] } });
    await pending; fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.sticker-icon').length).toBe(1);
    expect(component.messageText(component.messages[0])).toBe('🥹');
    expect(component.isSticker(component.messages[1])).toBe(false);
    expect(component.canRecall(component.messages[0])).toBe(false);
    const recallPoll = component.loadReactions();
    TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', messages: [{ ...sticker, text: 'Tin nhắn đã được thu hồi', recalledAt: 123 }, plain], reactions: { sticker: [], plain: [] } });
    await recallPoll;
    (component as any).rememberMessages('server-room', [sticker]);
    fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sticker-icon')).toBeNull();
    expect(fixture.nativeElement.querySelector('.reaction-badge')).toBeNull();
    expect(component.messageText(component.messages[0])).toBe('Tin nhắn đã được thu hồi');
    expect(component.canReact(component.messages[0])).toBe(false);
    expect(fixture.nativeElement.querySelector('.forward-trigger')).toBeNull();
  });

  it('forward: recalled copies hide their content, label and reactions using the existing recall rules', () => {
    component.isChatOpen = true;
    const copy = { messageId: 'copy', serverSessionId: 'target-room', sender: 'admin' as const, text: 'Copied secret', timestamp: 2, forwarded: true };
    component.messages = [copy]; component.reactionState = { copy: [{ actor: 'guest:user', emoji: '❤️' }] };
    (component as any).rememberMessages('target-room', [{ ...copy, recalledAt: 123 }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Copied secret');
    expect(fixture.nativeElement.textContent).not.toContain('Đã chuyển tiếp');
    expect(fixture.nativeElement.textContent).toContain('Tin nhắn đã được thu hồi');
    expect(component.canReact(copy)).toBe(false);
  });

  it('attachment: the existing plus menu selects one file, supports cancellation and preserves the draft', () => {
    component.isChatOpen = true; component.userMessageText = 'Keep draft'; fixture.detectChanges();
    fixture.nativeElement.querySelector('#btn-plus').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-menu').textContent).toContain('Gửi ảnh');
    expect(fixture.nativeElement.querySelector('.attachment-menu').textContent).toContain('Gửi file');
    expect(fixture.nativeElement.querySelector('#chat-file-input').multiple).toBe(false);
    component.attachmentKind = 'file';
    component.pickAttachment({ target: { files: [new File(['hello'], 'a.txt')] } } as unknown as Event);
    expect(component.selectedAttachment?.name).toBe('a.txt'); component.cancelAttachment();
    expect(component.selectedAttachment).toBeNull(); expect(component.userMessageText).toBe('Keep draft');
    component.pickAttachment({ target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.txt')] } } as unknown as Event);
    expect(component.selectedAttachment).toBeNull(); expect(component.attachmentError).toContain('10 MB');
    TestBed.inject(HttpTestingController).expectNone(req => req.url.includes('attachments'));
  });

  it('attachment: confirmation retries one request key, retains draft, and polls the server-confirmed message', async () => {
    (component as any).currentSessionId = 'room';
    (component as any).reactionSessions.set('guest:room', Promise.resolve({ serverId: 'server-room', actor: 'guest:user' }));
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'ai', messages: [] } }));
    component.userMessageText = 'Keep draft'; component.attachmentKind = 'file';
    const file = new File(['Hello'], 'a.txt', { type: 'text/plain' });
    component.pickAttachment({ target: { files: [file] } } as unknown as Event);
    const http = TestBed.inject(HttpTestingController);
    let pending = component.sendAttachment(); await new Promise(resolve => setTimeout(resolve, 0));
    const failed = http.expectOne('/api/chat/sessions/server-room/attachments');
    const key = failed.request.headers.get('X-Client-Request-Id');
    failed.flush({ message: 'Retry' }, { status: 503, statusText: 'Unavailable' }); await pending;
    expect(component.selectedAttachment).toBe(file);
    pending = component.sendAttachment(); await component.sendAttachment(); await new Promise(resolve => setTimeout(resolve, 0));
    const request = http.expectOne('/api/chat/sessions/server-room/attachments');
    expect(request.request.body).toBe(file); expect(request.request.headers.get('X-Client-Request-Id')).toBe(key);
    const message = { messageId: 'file', sender: 'user', senderId: 'guest:user', clientRequestId: key, type: 'file', text: '[File đính kèm]', attachment: { name: 'a.txt', mime: 'text/plain', size: 5 }, timestamp: 1 };
    request.flush({ acceptedMessage: message }); await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'ai', messages: [message], reactions: { file: [] } });
    await pending;
    expect(component.messages.length).toBe(1); expect(component.userMessageText).toBe('Keep draft');
    expect(component.selectedAttachment).toBeNull(); expect(component.canReact(component.messages[0])).toBe(true);
    expect(component.canRecall(component.messages[0])).toBe(true);
    expect(localStorage.getItem('urii_chat_sessions')).not.toContain('a.txt');
    http.expectNone(req => req.url.includes('/ai') || req.url.includes('/match'));
  });

  it('attachment: reload verifies server metadata and remote recall removes file controls', async () => {
    (component as any).currentSessionId = 'room'; component.isChatOpen = true;
    const cached = { messageId: 'file', serverSessionId: 'server-room', sender: 'admin' as const, text: '[Tệp đính kèm]', timestamp: 1 };
    const message = { ...cached, type: 'file', senderId: 'account:admin', attachment: { name: 'private.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 234 } };
    localStorage.setItem('urii_chat_sessions', JSON.stringify({ room: { sessionId: 'room', status: 'active', messages: [cached] } }));
    expect(component.attachment(cached)).toBeNull();
    const http = TestBed.inject(HttpTestingController);
    let pending = component.loadReactions();
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', messages: [message], reactions: { file: [] } }); await pending;
    fixture.detectChanges(); expect(fixture.nativeElement.querySelector('.chat-file-button').textContent).toContain('private.docx');
    pending = component.loadReactions();
    http.expectOne('/api/chat/sessions/server-room/reactions').flush({ actor: 'guest:user', status: 'active', messages: [{ ...message, text: 'Tin nhắn đã được thu hồi', attachment: undefined, recalledAt: 123 }], reactions: { file: [] } }); await pending;
    fixture.detectChanges(); expect(fixture.nativeElement.querySelector('.chat-file-button')).toBeNull();
    expect(component.attachment(component.messages[0])).toBeNull(); expect(component.canReact(component.messages[0])).toBe(false);
    expect(component.messageText(component.messages[0])).toBe('Tin nhắn đã được thu hồi');
  });

  it('attachment: images load privately as blobs, open large, and disappear on recall', async () => {
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static override createObjectURL = vi.fn(() => 'blob:private-image'); static override revokeObjectURL = vi.fn(); });
    component.isChatOpen = true;
    const message = { messageId: 'image', serverSessionId: 'server-room', type: 'image' as const, sender: 'admin' as const, text: '[Ảnh]', timestamp: 1, attachment: { name: 'a.png', mime: 'image/png', size: 12 } };
    component.messages = [message]; (component as any).rememberMessages('server-room', [message]);
    fixture.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/chat/sessions/server-room/messages/image/attachment');
    expect(request.request.responseType).toBe('blob'); request.flush(new Blob(['image'], { type: 'image/png' }));
    await new Promise(resolve => setTimeout(resolve, 0)); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-attachment-image').getAttribute('src')).toBe('blob:private-image');
    fixture.nativeElement.querySelector('.chat-image-button').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-lightbox')).not.toBeNull();
    (component as any).rememberMessages('server-room', [{ ...message, recalledAt: 123 }]);
    (component as any).cdr.markForCheck(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attachment-lightbox')).toBeNull(); expect(fixture.nativeElement.querySelector('.chat-attachment-image')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-image');
  });
});
