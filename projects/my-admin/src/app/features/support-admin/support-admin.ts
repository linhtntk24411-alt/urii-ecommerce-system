import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { AdminRealtimeService } from '../../core/services/admin-realtime.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-support-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support-admin.html',
  styleUrls: ['./support-admin.css']
})
export class SupportAdmin implements OnInit, OnDestroy {
  private readonly socket = inject(AdminSocketService);
  sessions: { [key: string]: any } = {};
  currentFilter: string = 'all'; // 'all', 'waiting', 'active'
  selectedSessionId: string | null = null;
  searchQuery: string = '';
  lastKnownSessionsJSON: string = '';
  
  adminReplyText: string = '';
  activeTab: 'chat' | 'faqs' = 'chat';

  // Quản lý kịch bản FAQs Chatbot (Thêm, Sửa, Xóa)
  faqs: any[] = [];
  faqSearchQuery: string = '';
  isLoadingFaqs: boolean = false;
  faqModalOpen: boolean = false;
  isEditingFaq: boolean = false;
  editingFaqId: string | null = null;
  faqForm = {
    intent: '',
    title: '',
    keywords: '',
    response: '',
    quickReplies: ''
  };
  isSavingFaq: boolean = false;
  faqSaveError: string = '';
  deleteFaqModalOpen: boolean = false;
  faqToDelete: any = null;
  deleteSessionModalOpen: boolean = false;
  sessionToDelete: any = null;
  isDeletingSession: boolean = false;
  isDeletingFaq: boolean = false;

  private pollInterval: any;
  reactionEmojis = ['❤️', '😂', '😮', '😢', '😡', '👍'];
  reactionState: Record<string, { actor: string; emoji: string }[]> = {};
  reactionActor = '';
  reactionPicker: string | null = null;
  reactionBusy = false;
  reactionError = '';
  private reactionLoading = false;
  private messageEpoch = 0;
  private sessionVersions = new Map<string, number>();
  private acceptSnapshot(sessionId: string, updatedAt: unknown): boolean {
    const version = new Date(String(updatedAt || '')).getTime();
    if (!Number.isFinite(version)) return true;
    if (version < (this.sessionVersions.get(sessionId) || 0)) return false;
    this.sessionVersions.set(sessionId, version); return true;
  }
  recallMenu: string | null = null;
  recallBusy = false;
  recallError = '';
  private verifiedMessages = new Map<string, any>();
  private unverifiedMessages = new Set<string>();
  private verificationIdentity = '';
  forwardSource: { sessionId: string; messageId: string; requestId: string } | null = null;
  forwardTargets: { sessionId: string; userName: string; userEmail: string }[] = [];
  forwardSearch = '';
  forwardTargetId = '';
  forwardBusy = false;
  forwardLoading = false;
  forwardError = '';
  forwardNotice = '';
  private forwardNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  stickerIcons = ['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋'];
  isStickerPickerOpen = false;
  stickerBusy = false;
  stickerError = '';
  private pendingSticker: { sessionId: string; icon: string; requestId: string } | null = null;
  attachmentMenu = false;
  attachmentKind: 'image' | 'file' = 'image';
  selectedAttachment: File | null = null;
  attachmentPreview = '';
  attachmentBusy = false;
  attachmentError = '';
  attachmentViewer = '';
  private attachmentRequestId = '';
  private attachmentSessionId = '';
  private attachmentUrls = new Map<string, string>();
  private attachmentLoading = new Set<string>();
  private attachmentGeneration = 0;

  toggleAttachmentMenu(event: Event): void { event.stopPropagation(); this.attachmentMenu = !this.attachmentMenu; }
  chooseAttachment(kind: 'image' | 'file', input: HTMLInputElement): void {
    this.attachmentKind = kind; this.attachmentMenu = false;
    input.accept = kind === 'image' ? '.jpg,.jpeg,.png' : '.pdf,.docx,.xlsx,.txt'; input.value = ''; input.click();
  }
  pickAttachment(event: Event): void {
    if (this.attachmentBusy) return;
    const input = event.target as HTMLInputElement; const file = input.files?.[0];
    this.cancelAttachment();
    if (!file) return;
    const allowed = this.attachmentKind === 'image' ? /\.(jpe?g|png)$/i : /\.(pdf|docx|xlsx|txt)$/i;
    if (!allowed.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) { this.attachmentError = 'Chọn đúng loại file, tối đa 10 MB.'; return; }
    this.selectedAttachment = file; this.attachmentSessionId = this.selectedSessionId || ''; this.attachmentRequestId = crypto.randomUUID();
    if (this.attachmentKind === 'image') this.attachmentPreview = URL.createObjectURL(file);
  }
  cancelAttachment(): void {
    if (this.attachmentBusy) return;
    if (this.attachmentPreview) URL.revokeObjectURL(this.attachmentPreview);
    this.selectedAttachment = null; this.attachmentPreview = ''; this.attachmentError = ''; this.attachmentRequestId = '';
  }
  fileSize(bytes: number): string { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'; }
  attachment(message: any): any {
    const verified = this.verifiedMessage(message);
    return verified && !verified.recalledAt && ['image', 'file'].includes(verified.type) ? verified.attachment : null;
  }
  attachmentImage(message: any): string | undefined {
    if (!this.attachment(message) || this.verifiedMessage(message).type !== 'image') return undefined;
    const key = (this.reactionHeaders()['Authorization'] || '') + ':' + this.selectedSessionId + ':' + message.messageId;
    if (!this.attachmentUrls.has(key) && !this.attachmentLoading.has(key)) { this.attachmentLoading.add(key); void this.fetchAttachment(message, true, key); }
    return this.attachmentUrls.get(key);
  }
  private async fetchAttachment(message: any, image: boolean, key = ''): Promise<string | undefined> {
    const sessionId = this.selectedSessionId; const identity = this.reactionHeaders()['Authorization']; const generation = this.attachmentGeneration;
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId!)}/messages/${encodeURIComponent(message.messageId)}/attachment`, { headers: this.reactionHeaders(), cache: 'no-store' });
      if (!response.ok) throw new Error('Không thể tải file hoặc tin đã thu hồi.');
      const blob = await response.blob();
      if (sessionId !== this.selectedSessionId || generation !== this.attachmentGeneration || identity !== this.reactionHeaders()['Authorization'] || !this.attachment(message)) return;
      if (image && !['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Ảnh không hợp lệ.');
      const url = URL.createObjectURL(blob);
      if (image) this.attachmentUrls.set(key, url);
      return url;
    } catch (error: any) { this.attachmentError = error.message; return; }
    finally { this.cdr.markForCheck(); }
  }
  async openAttachment(message: any): Promise<void> {
    const file = this.attachment(message); if (!file) return;
    if (this.verifiedMessage(message).type === 'image') { this.attachmentViewer = this.attachmentImage(message) || ''; return; }
    const url = await this.fetchAttachment(message, false); if (!url) return;
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private clearAttachmentUrls(): void {
    this.attachmentGeneration++;
    for (const url of this.attachmentUrls.values()) URL.revokeObjectURL(url);
    this.attachmentUrls.clear(); this.attachmentLoading.clear(); this.attachmentViewer = '';
  }
  @HostListener('document:click') closeAttachmentMenu(): void { this.attachmentMenu = false; }
  @HostListener('document:keydown.escape') closeAttachmentViewer(): void { this.attachmentViewer = ''; this.attachmentMenu = false; }

  async sendAttachment(): Promise<void> {
    const file = this.selectedAttachment; const sessionId = this.attachmentSessionId;
    const identity = this.reactionHeaders()['Authorization'];
    if (!file || this.attachmentBusy) return;
    if (sessionId !== this.selectedSessionId) { this.attachmentError = 'Hãy chọn lại file trong hội thoại hiện tại.'; return; }
    this.attachmentBusy = true; this.attachmentError = '';
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/attachments`, {
        method: 'POST', headers: { ...this.reactionHeaders(), 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Kind': this.attachmentKind, 'X-Client-Request-Id': this.attachmentRequestId }, body: file
      });
      const data = await response.json(); if (!response.ok || !data.acceptedMessage?.messageId) throw new Error(data.message || 'Chưa thể xác nhận file.');
      if (identity !== this.reactionHeaders()['Authorization']) return;
      this.rememberMessages(sessionId, [data.acceptedMessage]);
      const messages = this.sessions[sessionId]?.messages;
      if (messages && !messages.some((m: any) => m.messageId === data.acceptedMessage.messageId)) messages.push(data.acceptedMessage);
      this.saveSessions(); this.attachmentBusy = false; this.cancelAttachment();
      if (sessionId === this.selectedSessionId) await this.loadReactions();
    } catch (error: any) { this.attachmentError = error.message; }
    finally { this.attachmentBusy = false; this.cdr.markForCheck(); }
  }

  toggleStickerPicker(event: Event): void {
    event.stopPropagation(); this.stickerError = ''; this.isStickerPickerOpen = !this.isStickerPickerOpen;
  }

  @HostListener('document:click') closeStickerPicker(): void { this.isStickerPickerOpen = false; }
  @HostListener('document:keydown.escape') closeStickerPickerOnEscape(): void { this.isStickerPickerOpen = false; }

  isSticker(message: any): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(verified?.type === 'sticker' && !verified.recalledAt && this.stickerIcons.includes(verified.text));
  }

  canForward(message: any): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(message.messageId && verified && (verified.type || 'text') === 'text' && !verified.recalledAt && !verified.isSystemLog && ['admin', 'user'].includes(verified.sender));
  }

  isForwarded(message: any): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(verified?.forwarded && !verified.recalledAt);
  }

  getForwardTargets(): { sessionId: string; userName: string; userEmail: string }[] {
    const query = this.forwardSearch.trim().toLocaleLowerCase();
    return this.forwardTargets.filter(s => s.sessionId !== this.forwardSource?.sessionId &&
      (!query || [s.userName, s.userEmail, s.sessionId].some(value => value.toLocaleLowerCase().includes(query))));
  }

  async openForward(message: any, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canForward(message) || !this.selectedSessionId || this.forwardBusy) return;
    const source = { sessionId: this.selectedSessionId, messageId: message.messageId, requestId: crypto.randomUUID() };
    const headers = this.reactionHeaders();
    this.forwardSource = source; this.forwardTargetId = ''; this.forwardSearch = '';
    this.forwardError = ''; this.forwardNotice = ''; this.forwardTargets = []; this.forwardLoading = true;
    this.reactionPicker = null; this.recallMenu = null;
    try {
      const response = await fetch('/api/chat/sessions', { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể tải hội thoại.');
      if (this.forwardSource !== source || headers['Authorization'] !== this.reactionHeaders()['Authorization']) return;
      this.forwardTargets = (data.sessions || []).filter((s: any) => s.sessionId !== source.sessionId).map((s: any) => ({
        sessionId: s.sessionId, userName: s.userName || 'Khách vãng lai', userEmail: s.userEmail || ''
      }));
    } catch (error) { if (this.forwardSource === source) this.forwardError = (error as Error).message; }
    finally { if (this.forwardSource === source) this.forwardLoading = false; this.cdr.markForCheck(); }
  }

  cancelForward(): void { if (!this.forwardBusy) { this.forwardSource = null; this.forwardError = ''; } }
  @HostListener('document:keydown.escape') closeForwardOnEscape(): void { this.cancelForward(); }

  async forward(): Promise<void> {
    const source = this.forwardSource;
    const targetId = this.forwardTargetId;
    if (!source || this.forwardBusy || this.forwardLoading || !targetId || targetId === source.sessionId || !this.forwardTargets.some(s => s.sessionId === targetId)) return;
    const headers = this.reactionHeaders();
    this.forwardBusy = true; this.forwardError = '';
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(source.sessionId)}/messages/${encodeURIComponent(source.messageId)}/forward`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSessionId: targetId, clientRequestId: source.requestId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể chuyển tiếp tin nhắn.');
      if (headers['Authorization'] !== this.reactionHeaders()['Authorization']) return;
      this.rememberMessages(targetId, [data.message]);
      const target = this.forwardTargets.find(s => s.sessionId === targetId)!;
      this.forwardNotice = `Đã chuyển tiếp đến ${target.userName}.`;
      clearTimeout(this.forwardNoticeTimer);
      this.forwardNoticeTimer = setTimeout(() => { this.forwardNotice = ''; this.cdr.markForCheck(); }, 5000);
      this.forwardSource = null;
      this.loadSessions();
    } catch (error) { this.forwardError = (error as Error).message; }
    finally { this.forwardBusy = false; this.cdr.markForCheck(); }
  }

  private rememberMessages(sessionId: string, messages: any[], fromPoll = false): void {
    if (!fromPoll) this.messageEpoch++;
    const identity = this.reactionHeaders()['Authorization'] || '';
    if (this.verificationIdentity !== identity) { this.clearAttachmentUrls(); this.verifiedMessages.clear(); this.unverifiedMessages.clear(); this.verificationIdentity = identity; }
    for (const message of messages) {
      if (!message.messageId) continue;
      const key = sessionId + ':' + message.messageId;
      const previous = this.verifiedMessages.get(key);
      this.unverifiedMessages.delete(key);
      // Recall is irreversible: late polling responses cannot restore old content.
      if (!previous?.recalledAt || message.recalledAt) this.verifiedMessages.set(key, message);
      if (this.verifiedMessages.get(key)?.recalledAt) {
        if (!previous?.recalledAt) this.clearAttachmentUrls();
        this.reactionState = { ...this.reactionState, [message.messageId]: [] };
        if (this.reactionPicker === message.messageId) this.reactionPicker = null;
        if (this.recallMenu === message.messageId) this.recallMenu = null;
      }
    }
  }

  private verifiedMessage(message: any, sessionId = this.selectedSessionId || ''): any {
    if (this.verificationIdentity !== (this.reactionHeaders()['Authorization'] || '')) return undefined;
    const key = sessionId + ':' + message.messageId;
    const verified = this.verifiedMessages.get(key);
    return verified?.recalledAt || !this.unverifiedMessages.has(key) ? verified : undefined;
  }

  messageText(message: any, sessionId = this.selectedSessionId || ''): string {
    if (!message.messageId) return message.type === 'sticker' ? 'Đang xác nhận icon…' : message.text || '';
    const verified = this.verifiedMessage(message, sessionId);
    return verified?.recalledAt ? 'Tin nhắn đã được thu hồi' : verified?.text ?? 'Đang xác minh tin nhắn…';
  }

  isRecalled(message: any): boolean { return Boolean(this.verifiedMessage(message)?.recalledAt); }

  canRecall(message: any): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(message.messageId && verified && !verified.isSystemLog && !verified.recalledAt &&
      verified.sender === 'admin' && verified.senderId && verified.senderId === this.reactionActor);
  }

  openRecall(message: any, event: Event): void {
    event.stopPropagation(); this.recallError = ''; this.reactionPicker = null;
    this.recallMenu = this.recallMenu === message.messageId ? null : message.messageId;
  }

  async recall(message: any, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canRecall(message) || this.recallBusy || !this.selectedSessionId) return;
    const sessionId = this.selectedSessionId;
    const headers = this.reactionHeaders();
    if (!window.confirm('Bạn có chắc muốn thu hồi tin nhắn này?')) return;
    this.recallBusy = true; this.recallError = '';
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(message.messageId)}/recall`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể thu hồi tin nhắn.');
      if ((headers['Authorization'] || '') === (this.reactionHeaders()['Authorization'] || '')) this.rememberMessages(sessionId, [data.message]);
      this.recallMenu = null;
    } catch (error) { this.recallError = (error as Error).message; }
    finally { this.recallBusy = false; this.cdr.markForCheck(); }
  }

  @HostListener('document:click') closeRecall(): void { this.recallMenu = null; }
  @HostListener('document:keydown.escape') closeRecallOnEscape(): void { this.recallMenu = null; }

  private reactionHeaders(): Record<string, string> {
    const token = this.adminApi.token() || (typeof localStorage !== 'undefined'
      ? localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '' : '');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async loadReactions(): Promise<void> {
    const epoch = this.messageEpoch;
    const sessionId = this.selectedSessionId;
    if (!sessionId || this.reactionLoading) return;
    const identity = this.reactionHeaders()['Authorization'] || '';
    this.reactionLoading = true;
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/reactions`, { headers: this.reactionHeaders(), cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (epoch !== this.messageEpoch || this.selectedSessionId !== sessionId || identity !== (this.reactionHeaders()['Authorization'] || '')) return;
      if (!this.acceptSnapshot(sessionId, data.updatedAt)) return;
      this.reactionState = data.reactions || {};
      this.reactionActor = data.actor;
      this.rememberMessages(sessionId, data.messages || [], true);
      this.cdr.markForCheck();
    } catch { /* Keep the last server-confirmed reactions until polling reconnects. */ }
    finally { this.reactionLoading = false; }
  }

  canReact(message: any): boolean {
    return Boolean(!message.isSystemLog && !this.isRecalled(message) && message.messageId && Object.hasOwn(this.reactionState, message.messageId));
  }

  openReaction(message: any, event: Event): void {
    event.stopPropagation();
    this.recallMenu = null;
    this.reactionError = '';
    this.reactionPicker = this.reactionPicker === message.messageId ? null : message.messageId;
  }

  async react(message: any, emoji: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canReact(message) || this.reactionBusy || !this.selectedSessionId) return;
    const sessionId = this.selectedSessionId;
    const previous = this.reactionState[message.messageId]?.find(r => r.actor === this.reactionActor);
    this.reactionBusy = true;
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(message.messageId)}/reaction`, {
        method: 'PUT', headers: { ...this.reactionHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: previous?.emoji === emoji ? null : emoji })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể lưu cảm xúc.');
      this.messageEpoch++;
      if (this.selectedSessionId === sessionId && !this.isRecalled(message)) this.reactionState = { ...this.reactionState, [message.messageId]: data.reactions };
      this.reactionPicker = null;
    } catch (error) { this.reactionError = (error as Error).message; }
    finally { this.reactionBusy = false; this.cdr.markForCheck(); }
  }

  @HostListener('document:click') closeReaction(): void { this.reactionPicker = null; }
  @HostListener('document:keydown.escape') closeReactionOnEscape(): void { this.reactionPicker = null; }
  private routeSub: any;
  private sessionsRequest = 0;
  private realtimeSub = new Subscription();

  constructor(
    private cdr: ChangeDetectorRef,
    private adminApi: AdminApiService,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: object,
    private adminRealtime: AdminRealtimeService
  ) {}

  ngOnInit(): void {
    this.loadSessions();
    this.realtimeSub.add(this.socket.onChatUpdate().subscribe(() => { this.loadSessions(true); void this.loadReactions(); }));
    this.realtimeSub.add(this.socket.onCrudChange('chat').subscribe(() => { this.loadSessions(true); void this.loadReactions(); }));
    this.realtimeSub.add(this.adminRealtime.crudChanged$.subscribe((event) => {
      if (event.resource === 'chat') {
        this.loadSessions(true);
      }
    }));

    this.realtimeSub.add(this.adminRealtime.chatMessage$.subscribe((msg) => {
      if (msg && msg.sessionId === this.selectedSessionId) {
        this.loadSessions(true);
      }
    }));
    this.lastKnownSessionsJSON = typeof localStorage !== 'undefined' ? (localStorage.getItem('urii_chat_sessions') || '{}') : '{}';

    // Lắng nghe queryParams để tự động chọn phiên chat khi click từ thông báo
    this.routeSub = this.route.queryParams.subscribe(params => {
      const sid = params['sessionId'];
      if (sid) {
        this.selectedSessionId = sid;
        if (this.sessions[sid]) {
          this.selectSession(sid);
        }
      }
    });
    
    // Kiểm tra đồng bộ định kỳ từ server backend
    if (isPlatformBrowser(this.platformId)) {
      this.pollInterval = setInterval(() => { this.loadSessions(true); void this.loadReactions(); }, 3000);
    }
  }

  ngOnDestroy(): void {
    this.clearAttachmentUrls(); this.attachmentBusy = false; this.cancelAttachment();
    clearTimeout(this.forwardNoticeTimer);
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
    if (this.realtimeSub) {
      this.realtimeSub.unsubscribe();
    }
  }

  getSessionsArray(): any[] {
    return Object.values(this.sessions);
  }

  getWaitingCount(): number {
    return this.getSessionsArray().filter(s => s.status === 'waiting').length;
  }

  setFilter(filter: string) {
    this.currentFilter = filter;
  }

  getFilteredSessions(): any[] {
    let list = this.getSessionsArray();

    // Lọc theo tìm kiếm
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(s => 
        (s.userName && s.userName.toLowerCase().includes(q)) || 
        (s.userEmail && s.userEmail.toLowerCase().includes(q))
      );
    }

    // Lọc theo Tab trạng thái
    if (this.currentFilter === 'waiting') {
      list = list.filter(s => s.status === 'waiting');
    } else if (this.currentFilter === 'active') {
      list = list.filter(s => s.status === 'active');
    }

    // Sắp xếp tin nhắn mới nhất lên đầu
    return list.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
  }

  loadSessions(silent = false) {
    const request = ++this.sessionsRequest;
    const epoch = this.messageEpoch;
    const identity = this.reactionHeaders()['Authorization'] || '';
    if (!silent && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const local = JSON.parse(localStorage.getItem('urii_chat_sessions') || '{}');
        if (local && Object.keys(local).length > 0) {
          this.sessions = local;
        }
      } catch (e) {
        this.sessions = {};
      }
    }

    // Tải đồng bộ từ MongoDB backend
    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    fetch('/api/chat/sessions', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(r => r.json())
      .then(data => {
        if (epoch !== this.messageEpoch || request !== this.sessionsRequest || identity !== (this.reactionHeaders()['Authorization'] || '')) return;
        const list = Array.isArray(data) ? data : (data?.sessions || []);
        if (list.length > 0) {
          const map: { [key: string]: any } = { ...this.sessions };
          const prevSelectedMsgCount = this.selectedSessionId ? (this.sessions[this.selectedSessionId]?.messages?.length || 0) : 0;
          list.forEach((s: any) => {
            const key = s.sessionId || s._id;
            if (!this.acceptSnapshot(key, s.updatedAt)) return;
            this.rememberMessages(key, s.messages || [], true);
            const cacheMessage = ({ recalledAt, recalledBy, ...message }: any) => message;
            const localMessages = this.sessions[key]?.messages;
            const messages = localMessages ? [...localMessages] : (s.messages || []).map(cacheMessage);
            if (localMessages) {
              for (const incoming of s.messages || []) {
                if (!incoming.messageId) continue;
                const index = messages.findIndex((m: any) => m.messageId === incoming.messageId ||
                  (m.clientRequestId && m.clientRequestId === incoming.clientRequestId && m.sender === incoming.sender));
                if (index < 0) messages.push(cacheMessage(incoming));
                else if (!messages[index].messageId) messages[index] = { ...messages[index], messageId: incoming.messageId, senderId: incoming.senderId };
              }
            }
            map[key] = {
              ...s,
              messages,
              sessionId: key,
              lastMessageTime: s.lastMessageTime || (s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now())
            };
          });

          this.sessions = map;
          if (typeof localStorage !== 'undefined') {
            this.saveSessions();
          }

          // Nếu có selectedSessionId từ route mà chưa được focus
          if (this.selectedSessionId && this.sessions[this.selectedSessionId]) {
            const newMsgCount = this.sessions[this.selectedSessionId].messages?.length || 0;
            if (newMsgCount > prevSelectedMsgCount) {
              this.scrollToBottom();
            }
          }

          this.cdr.detectChanges();
        }
      })
      .catch(err => {
        if (!silent) console.error('Lỗi tải chat sessions từ backend:', err);
      });
  }

  saveSessions() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('urii_chat_sessions', JSON.stringify(this.sessions, (_key, value) => {
        if (value && typeof value === 'object' && ['sticker', 'image', 'file'].includes(value.type)) {
          const { type, text, attachment, ...metadata } = value;
          return { ...metadata, text: type === 'sticker' ? '[Icon cảm xúc]' : '[Tệp đính kèm]' };
        }
        return value;
      }));
    }
  }

  formatTime(timestamp: number): string {
    if (!timestamp) return 'Gần đây';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  getInitials(name: string): string {
    if (!name) return 'KV';
    return name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
  }

  getUserAvatarUrl(session: any): string {
    const avatar = String(session?.avatar || session?.userAvatar || '').trim();
    if (
      avatar.startsWith('http://') ||
      avatar.startsWith('https://') ||
      avatar.startsWith('data:')
    ) {
      return avatar;
    }

    return this.adminApi.getLibraryMapImageUrl(avatar || 'images/avatar_user.jpeg');
  }

  onUserAvatarError(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallbackUrl = this.adminApi.getLibraryMapImageUrl('images/avatar-non.jpg');
    if (image.src !== fallbackUrl) {
      image.src = fallbackUrl;
    }
  }

  selectSession(sessionId: string) {
    this.clearAttachmentUrls(); this.cancelAttachment(); this.attachmentMenu = false;
    if (this.selectedSessionId !== sessionId) {
      this.reactionState = {}; this.reactionPicker = null; this.recallMenu = null;
      for (const key of this.verifiedMessages.keys()) if (key.startsWith(sessionId + ':')) this.unverifiedMessages.add(key);
    }
    this.selectedSessionId = sessionId;
    void this.loadReactions();
    this.socket.joinChat(sessionId);
    const session = this.sessions[sessionId];
    if (!session) return;

    if (session.unreadCount > 0) {
      session.unreadCount = 0;
      this.sessions[sessionId] = session;
      this.saveSessions();
    }
    this.scrollToBottom();
  }

  getSelectedSession() {
    if (!this.selectedSessionId) return null;
    return this.sessions[this.selectedSessionId] || null;
  }

  getLastMessage(session: any): string {
    if (!session.messages || session.messages.length === 0) return 'Chưa có tin nhắn';
    const lastMsg = session.messages[session.messages.length - 1];
    let prefix = 'Urii: ';
    if (lastMsg.sender === 'user') prefix = 'Bạn: ';
    if (lastMsg.sender === 'admin') prefix = 'Admin: ';
    return `${prefix}${this.messageText(lastMsg, session.sessionId)}`;
  }

  sendAdminMessage(sticker?: string) {
    const isSticker = sticker !== undefined;
    if (isSticker && (this.stickerBusy || !this.stickerIcons.includes(sticker))) return;
    const text = isSticker ? sticker : this.adminReplyText.trim();
    if (!text || !this.selectedSessionId) return;

    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    let statusChanged = false;
    if (session.status !== 'active') {
      session.status = 'active';
      statusChanged = true;
      session.messages.push({
        text: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.',
        sender: 'admin',
        timestamp: Date.now(),
        isSystemLog: true
      });
    }

    const retry = isSticker && this.pendingSticker?.sessionId === this.selectedSessionId && this.pendingSticker.icon === sticker ? this.pendingSticker : null;
    const clientRequestId = retry?.requestId || crypto.randomUUID();
    const sentSessionId = this.selectedSessionId;
    if (isSticker) { this.stickerBusy = true; this.stickerError = ''; this.pendingSticker = { sessionId: sentSessionId, icon: sticker, requestId: clientRequestId }; }
    const adminMessage: any = session.messages.find((m: any) => m.clientRequestId === clientRequestId) || {
      text: text,
      sender: 'admin',
      ...(isSticker ? { type: 'sticker' } : {}),
      timestamp: Date.now(), clientRequestId
    };
    if (!session.messages.some((m: any) => m.clientRequestId === clientRequestId)) session.messages.push(adminMessage);
    session.lastMessageTime = Date.now();
    session.unreadCount = 0;

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isSticker ? this.reactionHeaders() : (token ? { Authorization: `Bearer ${token}` } : {}))
      },
      body: JSON.stringify({ text, sender: 'admin', clientRequestId, ...(isSticker ? { type: 'sticker' } : {}) })
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể lưu tin nhắn.');
      const accepted = data.acceptedMessage;
      if (accepted?.clientRequestId === clientRequestId) {
        this.rememberMessages(sentSessionId, [accepted]);
        const localMessage = this.sessions[sentSessionId]?.messages.find((m: any) => m.clientRequestId === clientRequestId);
        if (localMessage) { localMessage.messageId = accepted.messageId; localMessage.senderId = accepted.senderId; }
        this.saveSessions();
        if (isSticker) { this.pendingSticker = null; this.isStickerPickerOpen = false; }
        void this.loadReactions();
      }
    }).catch(err => {
      if (isSticker) this.stickerError = err.message;
      else this.reactionError = err.message;
      console.error('Lỗi gửi tin nhắn admin:', err);
    }).finally(() => { if (isSticker) this.stickerBusy = false; this.cdr.markForCheck(); });

    if (!isSticker) this.adminReplyText = '';
  }

  takeoverChat() {
    if (!this.selectedSessionId) return;
    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    session.status = 'active';
    session.messages.push({
      text: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.',
      sender: 'admin',
      timestamp: Date.now(),
      isSystemLog: true
    });
    session.lastMessageTime = Date.now();
    session.unreadCount = 0;

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status: 'active', systemLog: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.' })
    })
      .then(() => this.loadSessions(true))
      .catch(err => console.error('Lỗi đổi trạng thái chat:', err));
  }

  handbackChat() {
    if (!this.selectedSessionId) return;
    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    session.status = 'ai';
    session.messages.push({
      text: 'Nhân viên đã trả lại phiên chat cho Urii Bot tự động tư vấn.',
      sender: 'bot',
      timestamp: Date.now(),
      isSystemLog: true
    });
    session.lastMessageTime = Date.now();

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status: 'ai', systemLog: 'Nhân viên đã trả lại phiên chat cho Urii Bot tự động tư vấn.' })
    })
      .then(() => this.loadSessions(true))
      .catch(err => console.error('Lỗi trả phiên chat cho bot:', err));
  }

  checkAndSyncStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    const currentJSON = localStorage.getItem('urii_chat_sessions') || '{}';
    if (currentJSON !== this.lastKnownSessionsJSON) {
      this.lastKnownSessionsJSON = currentJSON;
    }
    this.loadSessions();
    void this.loadReactions();
  }

  switchTab(tab: 'chat' | 'faqs'): void {
    this.activeTab = tab;
    if (tab === 'faqs') this.loadFaqs();
    else { this.loadSessions(true); void this.loadReactions(); }
  }

  loadFaqs(): void {
    this.isLoadingFaqs = true;
    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch('/api/chat/faqs', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => res.json())
      .then(data => {
        this.isLoadingFaqs = false;
        this.faqs = Array.isArray(data) ? data : [];
        this.cdr.detectChanges();
      })
      .catch(err => {
        this.isLoadingFaqs = false;
        console.error('Lỗi tải danh sách FAQ:', err);
        this.cdr.detectChanges();
      });
  }

  getFilteredFaqs(): any[] {
    if (!this.faqSearchQuery || !this.faqSearchQuery.trim()) {
      return this.faqs;
    }
    const q = this.faqSearchQuery.toLowerCase().trim();
    return this.faqs.filter(faq => {
      const title = (faq.title || '').toLowerCase();
      const intent = (faq.intent || '').toLowerCase();
      const response = (faq.response || '').toLowerCase();
      const keywords = (faq.keywords || []).map((k: string) => String(k).toLowerCase()).join(' ');
      return title.includes(q) || intent.includes(q) || response.includes(q) || keywords.includes(q);
    });
  }

  openCreateFaqModal(): void {
    this.isEditingFaq = false;
    this.editingFaqId = null;
    this.faqSaveError = '';
    this.faqForm = {
      intent: '',
      title: '',
      keywords: '',
      response: '',
      quickReplies: ''
    };
    this.faqModalOpen = true;
    this.cdr.detectChanges();
  }

  openEditFaqModal(faq: any): void {
    this.isEditingFaq = true;
    this.editingFaqId = faq.id || faq._id;
    this.faqSaveError = '';
    this.faqForm = {
      intent: faq.intent || '',
      title: faq.title || '',
      keywords: Array.isArray(faq.keywords) ? faq.keywords.join(', ') : '',
      response: faq.response || '',
      quickReplies: Array.isArray(faq.quickReplies) ? faq.quickReplies.join(', ') : ''
    };
    this.faqModalOpen = true;
    this.cdr.detectChanges();
  }

  closeFaqModal(): void {
    this.faqModalOpen = false;
    this.faqSaveError = '';
    this.isSavingFaq = false;
  }

  saveFaq(): void {
    if (!this.faqForm.title.trim() || !this.faqForm.intent.trim() || !this.faqForm.response.trim()) {
      this.faqSaveError = 'Vui lòng điền đầy đủ Tiêu đề, Mã Intent và Câu trả lời.';
      return;
    }

    const keywords = this.faqForm.keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const quickReplies = this.faqForm.quickReplies
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const payload = {
      title: this.faqForm.title.trim(),
      intent: this.faqForm.intent.trim(),
      keywords,
      response: this.faqForm.response.trim(),
      quickReplies
    };

    this.isSavingFaq = true;
    this.faqSaveError = '';

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    const url = this.isEditingFaq && this.editingFaqId
      ? `/api/chat/faqs/${encodeURIComponent(this.editingFaqId)}`
      : '/api/chat/faqs';
    const method = this.isEditingFaq ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    })
      .then(async res => {
        this.isSavingFaq = false;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Không thể lưu kịch bản FAQ.');
        }
        return res.json();
      })
      .then(() => {
        this.closeFaqModal();
        this.loadFaqs();
      })
      .catch(err => {
        this.isSavingFaq = false;
        this.faqSaveError = err.message || 'Lỗi kết nối máy chủ.';
        this.cdr.detectChanges();
      });
  }

  openDeleteFaqModal(faq: any): void {
    this.faqToDelete = faq;
    this.deleteFaqModalOpen = true;
    this.cdr.detectChanges();
  }

  closeDeleteFaqModal(): void {
    this.deleteFaqModalOpen = false;
    this.faqToDelete = null;
    this.isDeletingFaq = false;
  }

  confirmDeleteFaq(): void {
    if (!this.faqToDelete) return;
    const targetId = this.faqToDelete.id || this.faqToDelete._id;
    this.isDeletingFaq = true;

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    fetch(`/api/chat/faqs/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async res => {
        this.isDeletingFaq = false;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Không thể xóa FAQ.');
        }
        return res.json();
      })
      .then(() => {
        this.closeDeleteFaqModal();
        this.loadFaqs();
      })
      .catch(err => {
        this.isDeletingFaq = false;
        alert(err.message || 'Lỗi xóa FAQ.');
        this.cdr.detectChanges();
      });
  }

  openDeleteSessionModal(session: any, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.sessionToDelete = session;
    this.deleteSessionModalOpen = true;
  }

  closeDeleteSessionModal(): void {
    this.deleteSessionModalOpen = false;
    this.sessionToDelete = null;
    this.isDeletingSession = false;
  }

  confirmDeleteSession(): void {
    if (!this.sessionToDelete) return;
    const sessionId = this.sessionToDelete.sessionId || this.sessionToDelete.id;
    this.isDeletingSession = true;

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
      .then(async res => {
        this.isDeletingSession = false;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Không thể xóa cuộc trò chuyện.');
        }
        return res.json();
      })
      .then(() => {
        delete this.sessions[sessionId];
        this.saveSessions();
        if (this.selectedSessionId === sessionId) {
          this.selectedSessionId = '';
        }
        this.closeDeleteSessionModal();
        this.loadSessions(true);
        this.cdr.detectChanges();
      })
      .catch(err => {
        this.isDeletingSession = false;
        alert(err.message || 'Lỗi xóa cuộc trò chuyện.');
        this.cdr.detectChanges();
      });
  }

  private scrollToBottom(): void {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const el = document.getElementById('admin-chat-messages');
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 60);
  }
}
