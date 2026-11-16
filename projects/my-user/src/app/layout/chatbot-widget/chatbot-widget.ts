import { DialogService } from '../../core/services/dialog.service';
import { UserRealtimeService } from '../../core/services/realtime.service';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, AfterViewInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef, HostListener, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, delay, finalize, map, Observable, of, firstValueFrom, Subscription } from 'rxjs';
import { StorageService } from '../../core/services/storage.service';

interface ChatMessage {
  type?: 'text' | 'sticker' | 'image' | 'file';
  attachment?: { name: string; mime: string; size: number };
  messageId?: string;
  clientRequestId?: string;
  senderId?: string;
  forwarded?: boolean;
  serverSessionId?: string;
  targetUrl?: string;
  targetLabel?: string;
  isWarning?: boolean;
  text: string;
  sender: 'user' | 'bot' | 'admin';
  timestamp: number;
  chips?: { label: string; action: string }[];
  isSystemLog?: boolean;
}

interface ChatSession {
  sessionId: string;
  userName: string;
  userEmail: string;
  status: 'ai' | 'waiting' | 'active';
  lastMessageTime: number;
  unreadCount: number;
  messages: ChatMessage[];
}

interface ChatbotReply {
  targetUrl?: string;
  targetLabel?: string;
  isWarning?: boolean;
  text: string;
  chips?: { label: string; action: string }[];
}

interface ChatbotFaq {
  intent: string;
  keywords: string[];
  response: string;
  quickReplies: { label: string; action: string }[];
}

@Component({
  selector: 'app-chatbot-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.css'
})
export class ChatbotWidgetComponent implements OnInit, AfterViewInit, OnDestroy {
  isChatOpen: boolean = false;
  isHistoryViewOpen: boolean = false;
  isEmojiPickerOpen: boolean = false;
  isTyping: boolean = false;
  userMessageText: string = '';
  
  botName: string = 'Trợ lý ảo Urii';
  botStatus: string = 'Đang trực tuyến';
  statusDotColor: boolean = true; 
  
  messages: ChatMessage[] = [];
  emojis: string[] = ['😊', '😂', '🥰', '👍', '🔥', '❤️', '✨', '⭐', '😭', '😮'];
  
  private currentSessionId: string = '';
  private memoryStorage: { [key: string]: string } = {};
  private syncInterval: any;
  private pendingBotReplies = 0;
  private readonly http = inject(HttpClient);
  private readonly dialogService = inject(DialogService);
  private readonly authStorage = inject(StorageService);
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
  private reactionIdentityKey = '';
  private reactionPreparation: Promise<unknown> = Promise.resolve();
  private reactionSessions = new Map<string, Promise<{ serverId: string; actor: string }>>();
  recallMenu: string | null = null;
  recallBusy = false;
  recallError = '';
  private verifiedMessages = new Map<string, any>();
  private unverifiedMessages = new Set<string>();
  private verificationIdentity = '';
  stickerIcons = ['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋'];
  isStickerPickerOpen = false;
  stickerBusy = false;
  stickerError = '';
  private pendingSticker: { localId: string; icon: string; requestId: string } | null = null;
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
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; this.cancelAttachment();
    if (!file) return;
    const allowed = this.attachmentKind === 'image' ? /\.(jpe?g|png)$/i : /\.(pdf|docx|xlsx|txt)$/i;
    if (!allowed.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) { this.attachmentError = 'Chọn đúng loại file, tối đa 10 MB.'; return; }
    this.selectedAttachment = file; this.attachmentSessionId = this.currentSessionId; this.attachmentRequestId = crypto.randomUUID();
    if (this.attachmentKind === 'image') this.attachmentPreview = URL.createObjectURL(file);
  }
  cancelAttachment(): void {
    if (this.attachmentBusy) return;
    if (this.attachmentPreview) URL.revokeObjectURL(this.attachmentPreview);
    this.selectedAttachment = null; this.attachmentPreview = ''; this.attachmentError = ''; this.attachmentRequestId = '';
  }
  fileSize(bytes: number): string { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'; }
  attachment(message: ChatMessage): any {
    const verified = this.verifiedMessage(message);
    return verified && !verified.recalledAt && ['image', 'file'].includes(verified.type) ? verified.attachment : null;
  }
  attachmentImage(message: ChatMessage): string | undefined {
    if (!this.attachment(message) || this.verifiedMessage(message).type !== 'image') return undefined;
    const key = (this.authStorage.getToken() || 'guest') + ':' + message.serverSessionId + ':' + message.messageId;
    if (!this.attachmentUrls.has(key) && !this.attachmentLoading.has(key)) { this.attachmentLoading.add(key); void this.fetchAttachment(message, true, key); }
    return this.attachmentUrls.get(key);
  }
  private async fetchAttachment(message: ChatMessage, image: boolean, key = ''): Promise<string | undefined> {
    const localId = this.currentSessionId; const identity = this.authStorage.getToken(); const generation = this.attachmentGeneration;
    try {
      const blob = await firstValueFrom(this.http.get(`/api/chat/sessions/${encodeURIComponent(message.serverSessionId!)}/messages/${encodeURIComponent(message.messageId!)}/attachment`, { responseType: 'blob' }));
      if (localId !== this.currentSessionId || generation !== this.attachmentGeneration || identity !== this.authStorage.getToken() || !this.attachment(message)) return;
      if (image && !['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Ảnh không hợp lệ.');
      const url = URL.createObjectURL(blob); if (image) this.attachmentUrls.set(key, url); return url;
    } catch { this.attachmentError = 'Không thể tải file hoặc tin đã thu hồi.'; return; }
    finally { this.cdr.markForCheck(); }
  }
  async openAttachment(message: ChatMessage): Promise<void> {
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
    const file = this.selectedAttachment; const localId = this.attachmentSessionId;
    if (!file || this.attachmentBusy) return;
    if (localId !== this.currentSessionId) { this.attachmentError = 'Hãy chọn lại file trong hội thoại hiện tại.'; return; }
    this.attachmentBusy = true; this.attachmentError = '';
    const identityToken = this.authStorage.getToken();
    try {
      this.getCurrentSession();
      const identity = await this.prepareReactionSession(localId);
      const data = await firstValueFrom(this.http.post<any>(`/api/chat/sessions/${encodeURIComponent(identity.serverId)}/attachments`, file, {
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Kind': this.attachmentKind, 'X-Client-Request-Id': this.attachmentRequestId }
      }));
      if (!data.acceptedMessage?.messageId) throw new Error('Chưa thể xác nhận file.');
      if (identityToken !== this.authStorage.getToken()) return;
      this.rememberMessages(identity.serverId, [data.acceptedMessage]);
      const sessions = this.getSessions(); const session = sessions[localId];
      if (session && !session.messages.some(m => m.messageId === data.acceptedMessage.messageId)) {
        session.messages.push({ ...data.acceptedMessage, serverSessionId: identity.serverId });
        session.lastMessageTime = Date.now(); this.saveSessions(sessions);
      }
      this.attachmentBusy = false; this.cancelAttachment();
      if (localId === this.currentSessionId) { this.messages = this.visibleMessages(session.messages); await this.loadReactions(); this.scrollToBottom(); }
    } catch (error: any) { this.attachmentError = error.error?.message || error.message || 'Không thể gửi file.'; }
    finally { this.attachmentBusy = false; this.cdr.markForCheck(); }
  }

  toggleStickerPicker(event: Event): void {
    event.stopPropagation(); this.stickerError = ''; this.isStickerPickerOpen = !this.isStickerPickerOpen;
  }

  @HostListener('document:click') closeStickerPicker(): void { this.isStickerPickerOpen = false; }
  @HostListener('document:keydown.escape') closeStickerPickerOnEscape(): void { this.isStickerPickerOpen = false; }

  isSticker(message: ChatMessage): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(verified?.type === 'sticker' && !verified.recalledAt && this.stickerIcons.includes(verified.text));
  }

  async sendSticker(icon: string): Promise<void> {
    if (this.stickerBusy || !this.stickerIcons.includes(icon)) return;
    this.stickerBusy = true; this.stickerError = '';
    const session = this.getCurrentSession();
    const localId = session.sessionId;
    const retry = this.pendingSticker?.localId === localId && this.pendingSticker.icon === icon ? this.pendingSticker : null;
    const requestId = retry?.requestId || crypto.randomUUID();
    this.pendingSticker = { localId, icon, requestId };
    const existing = session.messages.find(m => m.clientRequestId === requestId);
    const message: ChatMessage = { ...existing, type: 'sticker', text: icon, sender: 'user', timestamp: existing?.timestamp || Date.now(), clientRequestId: requestId };
    if (!existing) {
      session.messages.push(message);
      session.lastMessageTime = Date.now();
      if (session.status === 'active' || session.status === 'waiting') session.unreadCount = (session.unreadCount || 0) + 1;
      const sessions = this.getSessions(); sessions[localId] = session; this.saveSessions(sessions);
    }
    this.messages = this.visibleMessages(session.messages);
    this.cdr.markForCheck(); this.scrollToBottom();
    try {
      if (await this.persistUserMessage(message, localId)) { this.pendingSticker = null; this.isStickerPickerOpen = false; }
      else this.stickerError = this.reactionError || 'Chưa thể xác nhận icon. Bạn có thể thử lại.';
    } finally { this.stickerBusy = false; this.cdr.markForCheck(); }
  }

  private rememberMessages(serverId: string, messages: any[], fromPoll = false): void {
    if (!fromPoll) this.messageEpoch++;
    const identity = this.authStorage.getToken() || 'guest';
    if (this.verificationIdentity !== identity) { this.clearAttachmentUrls(); this.verifiedMessages.clear(); this.unverifiedMessages.clear(); this.verificationIdentity = identity; }
    for (const message of messages) {
      if (!message.messageId) continue;
      const key = serverId + ':' + message.messageId;
      const previous = this.verifiedMessages.get(key);
      this.unverifiedMessages.delete(key);
      if (!previous?.recalledAt || message.recalledAt) this.verifiedMessages.set(key, message);
      if (this.verifiedMessages.get(key)?.recalledAt) {
        if (!previous?.recalledAt) this.clearAttachmentUrls();
        this.reactionState = { ...this.reactionState, [message.messageId]: [] };
        if (this.reactionPicker === message.messageId) this.reactionPicker = null;
        if (this.recallMenu === message.messageId) this.recallMenu = null;
      }
    }
  }

  private verifiedMessage(message: ChatMessage): any {
    if (this.verificationIdentity !== (this.authStorage.getToken() || 'guest')) return undefined;
    const key = message.serverSessionId + ':' + message.messageId;
    const verified = this.verifiedMessages.get(key);
    return verified?.recalledAt || !this.unverifiedMessages.has(key) ? verified : undefined;
  }

  messageText(message: ChatMessage): string {
    if (!message.messageId) return message.type === 'sticker' ? 'Đang xác nhận icon…' : message.text;
    const verified = this.verifiedMessage(message);
    return verified?.recalledAt ? 'Tin nhắn đã được thu hồi' : verified?.text ?? 'Đang xác minh tin nhắn…';
  }

  isRecalled(message: ChatMessage): boolean { return Boolean(this.verifiedMessage(message)?.recalledAt); }

  isForwarded(message: ChatMessage): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(verified?.forwarded && !verified.recalledAt);
  }

  canShowContent(message: ChatMessage): boolean {
    return !message.messageId || Boolean(this.verifiedMessage(message) && !this.isRecalled(message));
  }

  private visibleMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(message => {
      if (!message.messageId) return message;
      const visible = { ...message, text: this.messageText(message) };
      if (!this.canShowContent(message)) { visible.chips = undefined; visible.targetUrl = undefined; visible.targetLabel = undefined; }
      return visible;
    });
  }

  canRecall(message: ChatMessage): boolean {
    const verified = this.verifiedMessage(message);
    return Boolean(message.messageId && message.serverSessionId && verified && !verified.isSystemLog && !verified.recalledAt &&
      verified.sender === 'user' && verified.senderId && verified.senderId === this.reactionActor);
  }

  openRecall(message: ChatMessage, event: Event): void {
    event.stopPropagation(); this.recallError = ''; this.reactionPicker = null;
    this.recallMenu = this.recallMenu === message.messageId ? null : message.messageId || null;
  }

  async recall(message: ChatMessage, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canRecall(message) || this.recallBusy) return;
    const localId = this.currentSessionId;
    const identity = this.authStorage.getToken() || 'guest';
    this.recallBusy = true; this.recallError = '';
    try {
      const confirmed = await this.dialogService.confirm('Bạn có chắc muốn thu hồi tin nhắn này?', 'Thu hồi tin nhắn', 'Thu hồi', 'Hủy');
      if (!confirmed || localId !== this.currentSessionId || identity !== (this.authStorage.getToken() || 'guest')) return;
      const data = await firstValueFrom(this.http.post<any>(`/api/chat/sessions/${encodeURIComponent(message.serverSessionId!)}/messages/${encodeURIComponent(message.messageId!)}/recall`, {}));
      if (identity !== (this.authStorage.getToken() || 'guest')) return;
      this.rememberMessages(message.serverSessionId!, [data.message]);
      this.messages = this.visibleMessages(this.messages);
      this.recallMenu = null;
    } catch (error: any) { this.recallError = error.error?.message || 'Không thể thu hồi tin nhắn.'; }
    finally { this.recallBusy = false; this.cdr.markForCheck(); }
  }

  @HostListener('document:click') closeRecall(): void { this.recallMenu = null; }
  @HostListener('document:keydown.escape') closeRecallOnEscape(): void { this.recallMenu = null; }

  private async prepareReactionSession(localId: string): Promise<{ serverId: string; actor: string }> {
    const authKey = this.authStorage.getToken() || 'guest';
    const key = authKey + ':' + localId;
    const existing = this.reactionSessions.get(key);
    if (existing) return existing;
    const pending = this.reactionPreparation.catch(() => undefined).then(async () => {
      const local = this.getSessions()[localId];
      let serverId = local?.messages.find(m => m.serverSessionId)?.serverSessionId || localId;
      const prepare = () => firstValueFrom(this.http.post<{ actor: string }>(`/api/chat/sessions/${encodeURIComponent(serverId)}/reaction-identity`, {
        userName: this.getCurrentUserName() || 'Khách vãng lai', userEmail: this.getCurrentUserEmail()
      }));
      let identity: { actor: string };
      try { identity = await prepare(); }
      catch (error: any) {
        if (error.status !== 403) throw error;
        // Preserve the old local history; new records use a separately owned server session.
        serverId = crypto.randomUUID();
        identity = await prepare();
      }
      return { serverId, actor: identity.actor };
    });
    this.reactionPreparation = pending;
    this.reactionSessions.set(key, pending);
    try { return await pending; }
    catch (error) { this.reactionSessions.delete(key); throw error; }
  }

  private async persistUserMessage(message: ChatMessage, localId: string): Promise<boolean> {
    try {
      const identity = await this.prepareReactionSession(localId);
      const sessions = this.getSessions();
      const pending = sessions[localId]?.messages.find(m => m.clientRequestId === message.clientRequestId);
      if (!pending) return false;
      pending.senderId = identity.actor;
      pending.serverSessionId = identity.serverId;
      this.saveSessions(sessions);
      const data = await firstValueFrom(this.http.post<any>(`/api/chat/sessions/${encodeURIComponent(identity.serverId)}/messages`, {
        text: message.text, sender: 'user', clientRequestId: message.clientRequestId, ...(message.type === 'sticker' ? { type: 'sticker' } : {})
      }));
      const fresh = this.getSessions();
      const localMessage = fresh[localId]?.messages.find(m => m.clientRequestId === message.clientRequestId);
      if (localMessage && data.acceptedMessage?.clientRequestId === message.clientRequestId) {
        this.rememberMessages(identity.serverId, [data.acceptedMessage]);
        localMessage.messageId = data.acceptedMessage.messageId;
        localMessage.senderId = data.acceptedMessage.senderId;
        localMessage.serverSessionId = identity.serverId;
        if (message.type === 'sticker') localMessage.type = data.acceptedMessage.type;
        this.saveSessions(fresh);
      }
      if (localId === this.currentSessionId) { this.messages = this.visibleMessages(fresh[localId].messages); await this.loadReactions(); }
      this.cdr.markForCheck();
      return Boolean(localMessage?.messageId);
    } catch (error: any) {
      this.reactionError = error.error?.message || 'Tin nhắn chưa được server xác nhận; chưa thể thả cảm xúc.';
    }
    this.cdr.markForCheck();
    return false;
  }

  async loadReactions(): Promise<void> {
    const epoch = this.messageEpoch;
    const localId = this.currentSessionId;
    const authKey = this.authStorage.getToken() || 'guest';
    const identityKey = authKey + ':' + localId;
    if (this.reactionIdentityKey !== identityKey) {
      this.reactionState = {}; this.reactionPicker = null; this.reactionActor = ''; this.reactionIdentityKey = identityKey;
    }
    if (this.reactionLoading) return;
    const local = this.getSessions()[localId];
    const known = this.reactionSessions.get(identityKey);
    const savedId = local?.messages.find(m => m.serverSessionId)?.serverSessionId;
    if (!known && !savedId) return;
    this.reactionLoading = true;
    try {
      const serverId = known ? (await known).serverId : savedId!;
      const data = await firstValueFrom(this.http.get<any>(`/api/chat/sessions/${encodeURIComponent(serverId)}/reactions`));
      if (epoch !== this.messageEpoch || localId !== this.currentSessionId || authKey !== (this.authStorage.getToken() || 'guest')) return;
      if (!this.acceptSnapshot(serverId, data.updatedAt)) return;
      this.reactionState = data.reactions || {};
      this.reactionActor = data.actor;
      this.realtimeService.joinChat(serverId);
      this.rememberMessages(serverId, data.messages || [], true);
      const sessions = this.getSessions();
      const session = sessions[localId];
      if (!session) return;
      let changed = false;
      for (const incoming of data.messages || []) {
        if (incoming.isSystemLog) continue;
        const own = session.messages.find(m => m.messageId === incoming.messageId ||
          (m.clientRequestId && m.clientRequestId === incoming.clientRequestId && m.senderId === incoming.senderId));
        if (!own) {
          const { recalledAt, recalledBy, ...cached } = incoming;
          session.messages.push({ ...cached, serverSessionId: serverId }); changed = true;
        }
        else if (!own.messageId) { own.messageId = incoming.messageId; own.serverSessionId = serverId; changed = true; }
      }
      if (session.status !== data.status) { session.status = data.status; changed = true; }
      if (changed) this.saveSessions(sessions);
      this.messages = this.visibleMessages(session.messages);
      this.updateHeaderStatus(session.status);
      this.cdr.markForCheck();
    } catch { /* No ownership or network access: retain local history without enabling reactions. */ }
    finally { this.reactionLoading = false; }
  }

  canReact(message: ChatMessage): boolean {
    return Boolean(!this.isRecalled(message) && message.messageId && Object.hasOwn(this.reactionState, message.messageId));
  }

  openReaction(message: ChatMessage, event: Event): void {
    this.recallMenu = null;
    event.stopPropagation(); this.reactionError = '';
    this.reactionPicker = this.reactionPicker === message.messageId ? null : message.messageId || null;
  }

  async react(message: ChatMessage, emoji: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canReact(message) || !message.serverSessionId || this.reactionBusy) return;
    const localId = this.currentSessionId;
    const previous = this.reactionState[message.messageId!]?.find(r => r.actor === this.reactionActor);
    this.reactionBusy = true;
    try {
      const data = await firstValueFrom(this.http.put<any>(`/api/chat/sessions/${encodeURIComponent(message.serverSessionId)}/messages/${encodeURIComponent(message.messageId!)}/reaction`, { emoji: previous?.emoji === emoji ? null : emoji }));
      this.messageEpoch++;
      if (localId === this.currentSessionId && !this.isRecalled(message)) this.reactionState = { ...this.reactionState, [message.messageId!]: data.reactions };
      this.reactionPicker = null;
    } catch (error: any) { this.reactionError = error.error?.message || 'Không thể lưu cảm xúc.'; }
    finally { this.reactionBusy = false; this.cdr.markForCheck(); }
  }

  @HostListener('document:click') closeReaction(): void { this.reactionPicker = null; }
  @HostListener('document:keydown.escape') closeReactionOnEscape(): void { this.reactionPicker = null; }
  private readonly realtimeService = inject(UserRealtimeService);
  private readonly realtimeSub = new Subscription();
  private joinRealtimeChat(): void {
    const serverId = this.getSessions()[this.currentSessionId]?.messages.find(m => m.serverSessionId)?.serverSessionId;
    if (serverId) this.realtimeService.joinChat(serverId);
  }

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef 
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.currentSessionId = this.getOrCreateSessionId();
      this.loadChatHistory();
      this.joinRealtimeChat();
      const refresh = () => { void this.loadReactions(); };
      this.realtimeSub.add(this.realtimeService.chatMessage$.subscribe(refresh));
      this.realtimeSub.add(this.realtimeService.chatStatus$.subscribe(refresh));
      this.realtimeSub.add(this.realtimeService.chatUpdated$.subscribe(refresh));
      this.realtimeSub.add(this.realtimeService.connected$.subscribe(connected => { if (connected) { this.joinRealtimeChat(); refresh(); } }));
    }
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // Đồng bộ định kỳ trạng thái chat
      this.syncInterval = setInterval(() => {
        this.syncChatUI();
      }, 1500);
    }
  }

  ngOnDestroy(): void {
    this.realtimeSub.unsubscribe();
    this.clearAttachmentUrls(); this.attachmentBusy = false; this.cancelAttachment();
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  toggleChatWindow(): void {
    this.isChatOpen = !this.isChatOpen;
    if (this.isChatOpen) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  
  
  isUserLoggedIn(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const email = localStorage.getItem('userEmail')?.trim();
    return localStorage.getItem('isLoggedIn') === 'true' && Boolean(email);
  }

  getCurrentUserAvatar(): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    const avatar = localStorage.getItem('userAvatar')?.trim();
    if (!avatar) return '';
    if (avatar.startsWith('/images/')) return `/api${avatar}`;
    if (avatar.startsWith('images/')) return `/api/${avatar}`;
    return avatar;
  }

  getCurrentUserName(): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    return localStorage.getItem('userName')?.trim() || '';
  }

  getCurrentUserEmail(): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    return localStorage.getItem('userEmail')?.trim().toLowerCase() || '';
  }

  getUserSessions(): ChatSession[] {
    const email = this.getCurrentUserEmail();
    if (!email) return [];
    const sessions = this.getSessions();
    return Object.values(sessions)
      .filter((s) => s.userEmail && s.userEmail.trim().toLowerCase() === email && s.messages && s.messages.length > 0)
      .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
  }

  toggleHistoryView(): void {
    if (!this.isUserLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để xem lịch sử chat',
        description: 'Vui lòng đăng nhập tài khoản Urii để xem lại các cuộc trò chuyện và lịch sử tư vấn trước đây.',
        returnUrl: this.router.url
      });
      return;
    }
    this.isHistoryViewOpen = !this.isHistoryViewOpen;
    this.cdr.detectChanges();
  }

  switchSession(sessionId: string): void {
    this.clearAttachmentUrls(); this.cancelAttachment(); this.attachmentMenu = false;
    const sessions = this.getSessions();
    if (!sessions[sessionId]) return;

    if (this.currentSessionId) { this.realtimeService.leaveChat(this.getSessions()[this.currentSessionId]?.messages.find(m => m.serverSessionId)?.serverSessionId || this.currentSessionId); }
    this.currentSessionId = sessionId;
    this.recallMenu = null;
    for (const message of sessions[sessionId].messages || []) {
      if (message.messageId) this.unverifiedMessages.add(message.serverSessionId + ':' + message.messageId);
    }
    const userEmail = this.getCurrentUserEmail();
    const cleanEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'guest';
    this.safeSetItem(`urii_chat_session_id_${cleanEmail}`, sessionId);

    this.messages = this.visibleMessages(sessions[sessionId].messages || []);
    this.updateHeaderStatus(sessions[sessionId].status || 'ai');
    this.isHistoryViewOpen = false;
    void this.loadReactions();
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 100);
  }

  deleteSession(sessionId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!sessionId) return;

    // 1. Gọi backend xóa phiên chat vĩnh viễn trên server
    this.http.delete(`/api/chat/sessions/${encodeURIComponent(this.getSessions()[sessionId]?.messages.find(m => m.serverSessionId)?.serverSessionId || sessionId)}`).subscribe({
      next: () => console.log('Đã xóa phiên chat trên server:', sessionId),
      error: (err) => console.warn('Lỗi gọi API xóa phiên chat:', err)
    });

    // 2. Xóa phiên chat khỏi localStorage
    const sessions = this.getSessions();
    delete sessions[sessionId];
    this.saveSessions(sessions);

    // 3. Nếu đang mở phiên bị xóa thì tạo phiên mới
    if (this.currentSessionId === sessionId) {
      this.resetChat();
    } else {
      this.cdr.detectChanges();
    }
  }

  confirmClearCurrentChat(): void {
    if (!this.currentSessionId) return;
    const hasMessages = this.messages && this.messages.length > 0;
    if (hasMessages) {
      const confirmed = window.confirm('Bạn có chắc chắn muốn xóa toàn bộ đoạn chat hiện tại không?');
      if (!confirmed) return;
    }
    this.deleteSession(this.currentSessionId);
  }

  formatSessionDate(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) {
      return `Hôm nay lúc ${timeStr}`;
    }
    return `${date.toLocaleDateString('vi-VN')} lúc ${timeStr}`;
  }

  getSessionPreview(session: ChatSession): string {
    if (!session.messages || session.messages.length === 0) return 'Chưa có tin nhắn';
    const last = session.messages[session.messages.length - 1];
    const text = this.messageText(last);
    return text.slice(0, 50) + (text.length > 50 ? '...' : '');
  }

  onInputKeyDown(event: KeyboardEvent, inputEl?: HTMLInputElement): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.sendMessage(inputEl);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.clearInput(inputEl);
    }
  }

  resetChat(): void {
    const isLoggedIn = this.safeGetItem('isLoggedIn') === 'true';
    const userEmail = isLoggedIn ? (this.safeGetItem('userEmail') || 'guest') : 'guest';
    const cleanEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
    const storageKey = `urii_chat_session_id_${cleanEmail}`;

    const newSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    this.currentSessionId = newSessionId;
    this.safeSetItem(storageKey, newSessionId);

    const sessions = this.getSessions();
    sessions[newSessionId] = {
      sessionId: newSessionId,
      userName: this.safeGetItem('userName') || 'Khách vãng lai',
      userEmail: this.safeGetItem('userEmail') || '',
      status: 'ai',
      lastMessageTime: Date.now(),
      unreadCount: 0,
      messages: []
    };
    this.saveSessions(sessions);

    this.messages = [];
    this.userMessageText = '';
    this.updateHeaderStatus('ai');
    this.cdr.detectChanges();
    this.loadChatHistory();
  }

  clearInput(inputEl?: HTMLInputElement): void {
    this.userMessageText = '';
    if (inputEl) inputEl.value = '';
    const el = document.getElementById('chat-input') as HTMLInputElement;
    if (el) el.value = '';
  }

  closeChat(): void {
    this.isChatOpen = false;
  }

  toggleEmojiPicker(event: Event): void {
    event.stopPropagation();
    this.isEmojiPickerOpen = !this.isEmojiPickerOpen;
  }

  addEmoji(emoji: string): void {
    this.userMessageText += emoji;
    this.isEmojiPickerOpen = false;
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('chat-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  private safeGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return this.memoryStorage[key] || null;
    }
  }

  private safeSetItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      this.memoryStorage[key] = value;
    }
  }

  private getOrCreateSessionId(): string {
    const isLoggedIn = this.safeGetItem('isLoggedIn') === 'true';
    const userEmail = isLoggedIn ? (this.safeGetItem('userEmail') || 'guest') : 'guest';
    const cleanEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
    const storageKey = `urii_chat_session_id_${cleanEmail}`;

    let sessionId = this.safeGetItem(storageKey);
    if (!sessionId) {
      sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      this.safeSetItem(storageKey, sessionId);
    }
    return sessionId;
  }

  private getSessions(): { [key: string]: ChatSession } {
    try {
      const val = this.safeGetItem('urii_chat_sessions');
      return val ? JSON.parse(val) : {};
    } catch (e) {
      return {};
    }
  }

  private saveSessions(sessions: { [key: string]: ChatSession }): void {
    try {
      this.safeSetItem('urii_chat_sessions', JSON.stringify(sessions, (_key, value) => {
        if (value && typeof value === 'object' && ['sticker', 'image', 'file'].includes(value.type)) {
          const { type, text, attachment, ...metadata } = value;
          return { ...metadata, text: type === 'sticker' ? '[Icon cảm xúc]' : '[Tệp đính kèm]' };
        }
        return value;
      }));
    } catch (e) {}
  }

  private getCurrentSession(): ChatSession {
    const sessions = this.getSessions();
    const userEmail = this.getCurrentUserEmail();
    const userName = this.safeGetItem('userName') || (userEmail ? userEmail.split('@')[0] : 'Khách vãng lai');

    if (!sessions[this.currentSessionId]) {
      sessions[this.currentSessionId] = {
        sessionId: this.currentSessionId,
        userName,
        userEmail,
        status: 'ai',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        messages: []
      };
      this.saveSessions(sessions);
    } else if (userEmail && (!sessions[this.currentSessionId].userEmail || sessions[this.currentSessionId].userEmail === 'guest')) {
      sessions[this.currentSessionId].userEmail = userEmail;
      sessions[this.currentSessionId].userName = userName;
      this.saveSessions(sessions);
    }
    return sessions[this.currentSessionId];
  }

  loadChatHistory(): void {
    const session = this.getCurrentSession();
    if (session.messages && session.messages.length > 0) {
      this.messages = this.visibleMessages(session.messages);
      this.updateHeaderStatus(session.status);
      void this.loadReactions();
    } else {
      this.pendingBotReplies += 1;
      this.isTyping = true;
      this.getWelcomeReply().pipe(
        finalize(() => {
          this.pendingBotReplies = Math.max(0, this.pendingBotReplies - 1);
          this.isTyping = this.pendingBotReplies > 0;
          this.cdr.detectChanges();
        }),
      ).subscribe({
        next: (reply) => {
          const currentSession = this.getCurrentSession();
          if (currentSession.messages.length === 0) {
            currentSession.messages.push({
              ...reply,
              timestamp: Date.now(),
              sender: 'bot',
            });
            currentSession.lastMessageTime = Date.now();
            const sessions = this.getSessions();
            sessions[currentSession.sessionId] = currentSession;
            this.saveSessions(sessions);
          }
          this.messages = this.visibleMessages(currentSession.messages);
          this.updateHeaderStatus(currentSession.status);
          this.cdr.detectChanges();
          this.scrollToBottom();
        },
        error: (error: unknown) => {
          console.error('Lỗi tải lời chào chatbot:', error);
          this.messages = [{
            text: 'Không thể kết nối trợ lý lúc này. Bạn vui lòng thử lại sau nhé.',
            sender: 'bot',
            timestamp: Date.now(),
          }];
          this.cdr.detectChanges();
        },
      });
    }
    this.cdr.detectChanges();
  }

  updateHeaderStatus(status: string): void {
    if (status === 'ai') {
      this.botName = 'Trợ lý ảo Urii';
      this.botStatus = 'Đang trực tuyến';
      this.statusDotColor = true;
    } else if (status === 'waiting') {
      this.botName = 'Trợ lý ảo Urii';
      this.botStatus = 'Đang kết nối nhân viên...';
      this.statusDotColor = false;
    } else if (status === 'active') {
      this.botName = 'Nhân viên tư vấn';
      this.botStatus = 'Nhân viên đang hỗ trợ';
      this.statusDotColor = false;
    }
  }

  syncChatUI(): void {
    void this.loadReactions();
    const session = this.getCurrentSession();
    if (session && session.messages && session.messages.length !== this.messages.length) {
      this.messages = this.visibleMessages(session.messages);
      this.cdr.detectChanges();
    }
  }

  syncSessionWithServer(): void { void this.loadReactions(); }

  sendMessage(inputEl?: HTMLInputElement): void {
    const raw = inputEl ? inputEl.value : this.userMessageText;
    const text = (raw || this.userMessageText || '').trim();
    if (!text) return;

    this.userMessageText = '';
    if (inputEl) inputEl.value = '';
    const domEl = document.getElementById('chat-input') as HTMLInputElement;
    if (domEl) domEl.value = '';

    setTimeout(() => {
      this.userMessageText = '';
      if (inputEl) inputEl.value = '';
      const el = document.getElementById('chat-input') as HTMLInputElement;
      if (el) el.value = '';
      this.cdr.detectChanges();
    }, 0);
    const session = this.getCurrentSession();

    const userMsg: ChatMessage = {
      text: text,
      sender: 'user',
      timestamp: Date.now(), clientRequestId: crypto.randomUUID()
    };
    session.messages.push(userMsg);
    session.lastMessageTime = Date.now();

    if (session.status === 'active' || session.status === 'waiting') {
      session.unreadCount = (session.unreadCount || 0) + 1;
    }

    const sessions = this.getSessions();
    sessions[session.sessionId] = session;
    this.saveSessions(sessions);

    this.messages = this.visibleMessages(session.messages);
    this.cdr.detectChanges(); 
    this.scrollToBottom();
    void this.persistUserMessage(userMsg, session.sessionId);

    const normQuery = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    if (['admin', 'tu van vien', 'gap nguoi', 'nhan vien', 'chat voi admin'].some(kw => normQuery.includes(kw)) && session.status === 'ai') {
      this.connectWithAdmin();
      return;
    }

    // Nếu đang chờ hoặc đang chat trực tiếp với nhân viên Admin -> gửi tin nhắn lên server
    if (session.status === 'waiting' || session.status === 'active') return;

    if (session.status === 'ai') {
      this.requestBotReply(text, session.sessionId);
    }
  }

  private requestBotReply(text: string, sessionId: string): void {
    this.pendingBotReplies += 1;
    this.isTyping = true;
    this.cdr.detectChanges();
    this.scrollToBottom();

    this.getBotReply(text).pipe(
      finalize(() => {
        this.pendingBotReplies = Math.max(0, this.pendingBotReplies - 1);
        this.isTyping = this.pendingBotReplies > 0;
        this.cdr.detectChanges();
      }),
    ).subscribe({
      next: (reply) => this.appendBotReply(reply, sessionId),
      error: (error: unknown) => {
        console.error('Lỗi tạo phản hồi chatbot:', error);
        this.appendBotReply({
          text: 'Xin lỗi, Urii chưa thể phản hồi lúc này. Bạn vui lòng thử lại sau nhé.',
        }, sessionId);
      },
    });
  }

  private appendBotReply(reply: ChatbotReply, sessionId: string): void {
    const currentSessions = this.getSessions();
    const freshSession = currentSessions[sessionId];
    if (!freshSession) return;

    freshSession.messages.push({
      text: reply.text,
      sender: 'bot',
      timestamp: Date.now(),
      chips: reply.chips,
      targetUrl: reply.targetUrl,
      targetLabel: reply.targetLabel,
      isWarning: reply.isWarning,
    });
    freshSession.lastMessageTime = Date.now();
    currentSessions[sessionId] = freshSession;
    this.saveSessions(currentSessions);

    if (sessionId === this.currentSessionId) {
      this.messages = this.visibleMessages(freshSession.messages);
      this.cdr.detectChanges();
      this.scrollToBottom();
    }
  }

  private getBotReply(userMessage: string): Observable<ChatbotReply> {
    const history = this.messages.slice(-6).map((m) => ({
      text: m.text,
      sender: m.sender,
    }));

    const context = {
      currentUrl: this.router.url,
      isLoggedIn: this.isUserLoggedIn(),
      userEmail: this.getCurrentUserEmail(),
    };

    return this.http.post<{
      success: boolean;
      reply: string;
      targetUrl?: string;
      targetLabel?: string;
      isWarning?: boolean;
      chips?: { label: string; action: string }[];
    }>('/api/chat/ai', {
      message: userMessage,
      history,
      context,
      sessionId: this.currentSessionId,
    }).pipe(
      map((res) => ({
        text: res.reply,
        targetUrl: res.targetUrl || undefined,
        targetLabel: res.targetLabel || undefined,
        isWarning: res.isWarning,
        chips: res.chips && res.chips.length > 0 ? res.chips : undefined,
      })),
      catchError((err) => {
        console.warn('Lỗi gọi API AI Chatbot, chuyển sang tìm kiếm FAQ dự phòng:', err);
        return this.getFaqs().pipe(
          map((response) => this.findFaqReply(response, userMessage)),
          delay(500),
        );
      }),
    );
  }

  private getWelcomeReply(): Observable<ChatbotReply> {
    return this.getFaqs().pipe(
      map((response) => {
        const greeting = this.toFaqs(response)
          .map((faq) => this.parseFaq(faq))
          .find((faq) => faq?.intent === 'greeting');
        return greeting
          ? { text: greeting.response, chips: greeting.quickReplies }
          : { text: 'Xin chào! Urii chưa có lời chào khả dụng. Bạn có thể nhập câu hỏi để mình tìm trong danh sách trợ giúp nhé.' };
      }),
      delay(1000),
    );
  }

  private getFaqs(): Observable<unknown> {
    return this.http.get<unknown>('/api/chatbot/faqs');
  }

  private findFaqReply(response: unknown, userMessage: string): ChatbotReply {
    const normalizedMessage = this.normalizeText(userMessage);
    const paddedMessage = ` ${normalizedMessage} `;
    let bestMatch: { faq: ChatbotFaq; score: number } | undefined;

    for (const record of this.toFaqs(response)) {
      const faq = this.parseFaq(record);
      if (!faq) continue;

      const matchedKeyword = faq.keywords
        .map((keyword) => this.normalizeText(keyword))
        .filter((keyword) => keyword && paddedMessage.includes(` ${keyword} `))
        .sort((first, second) => second.length - first.length)[0];
      if (matchedKeyword && (!bestMatch || matchedKeyword.length > bestMatch.score)) {
        bestMatch = { faq, score: matchedKeyword.length };
      }
    }

    if (bestMatch) {
      return {
        text: bestMatch.faq.response,
        chips: bestMatch.faq.quickReplies.length ? bestMatch.faq.quickReplies : undefined,
      };
    }

    const fallbackChips = this.toFaqs(response)
      .map((record) => this.parseFaq(record)?.quickReplies ?? [])
      .find((chips) => chips.length > 0);
    return {
      text: 'Dạ Urii chưa tìm thấy thông tin phù hợp. Bạn thử hỏi cách khác hoặc chọn một gợi ý bên dưới nhé.',
      chips: fallbackChips,
    };
  }

  private toFaqs(response: unknown): unknown[] {
    if (Array.isArray(response)) return response;
    return this.isRecord(response) && Array.isArray(response['faqs'])
      ? response['faqs']
      : [];
  }

  private parseFaq(value: unknown): ChatbotFaq | null {
    if (!this.isRecord(value) || typeof value['response'] !== 'string') return null;

    const keywords = Array.isArray(value['keywords'])
      ? value['keywords'].filter((keyword): keyword is string => typeof keyword === 'string')
      : [];
    const quickReplies = Array.isArray(value['quickReplies'])
      ? value['quickReplies'].flatMap((item): { label: string; action: string }[] => {
          if (typeof item === 'string' && item.trim()) {
            const text = item.trim();
            return [{ label: text, action: text }];
          }
          if (!this.isRecord(item)) return [];
          const label = this.toText(item['label'] ?? item['text'] ?? item['title'] ?? item['question']);
          const action = this.toText(item['action'] ?? item['value']) || label;
          return label ? [{ label, action }] : [];
        })
      : [];

    return {
      intent: this.normalizeText(this.toText(value['intent'])),
      keywords,
      response: value['response'],
      quickReplies,
    };
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  navigateToAction(url: string | undefined): void {
    if (!url) return;
    this.router.navigateByUrl(url);
  }

  
  connectWithAdmin(): void {
    const session = this.getCurrentSession();
    const userMsg: ChatMessage = {
      text: 'Yêu cầu liên hệ chat với Admin',
      sender: 'user',
      timestamp: Date.now()
    };
    session.messages.push(userMsg);
    session.status = 'waiting';
    session.unreadCount = (session.unreadCount || 0) + 1;
    session.lastMessageTime = Date.now();

    const botNotice: ChatMessage = {
      text: 'Dạ Urii đã gửi thông báo đến Quản trị viên/Admin rồi ạ! 🔔 Quản trị viên đã nhận được yêu cầu và sẽ phản hồi lại ngay cho bạn tại khung chat này. Bạn vui lòng đợi trong giây lát nhé! ✨',
      sender: 'bot',
      timestamp: Date.now() + 300,
      chips: [{ label: 'Hủy yêu cầu (Chat tiếp với AI)', action: 'Hủy yêu cầu' }]
    };
    session.messages.push(botNotice);

    const sessions = this.getSessions();
    sessions[session.sessionId] = session;
    this.saveSessions(sessions);

    this.messages = this.visibleMessages(session.messages);
    this.updateHeaderStatus('waiting');
    this.cdr.detectChanges();
    this.scrollToBottom();

    // Gửi yêu cầu lên backend tạo notification cho Admin
    this.prepareReactionSession(session.sessionId).then(identity => firstValueFrom(this.http.post('/api/chat/request-agent', {
      sessionId: identity.serverId,
      userName: session.userName,
      userEmail: session.userEmail,
      message: 'Khách hàng yêu cầu nhân viên tư vấn/admin hỗ trợ trực tiếp.'
    }))).then(() => console.log('Đã gửi thông báo cho admin'))
      .catch(err => console.warn('Lỗi gửi thông báo admin:', err));
  }

  handleChipClick(action: string): void {
    if (!action) return;

    if (action.startsWith('/')) {
      this.router.navigateByUrl(action);
      return;
    }

    if (action === 'Yêu cầu đặt hàng' || action === 'Đặt hàng yêu cầu') {
      this.router.navigate(['/custom-order']);
      return;
    }

    if (action === 'Hủy yêu cầu' || action.includes('Hủy yêu cầu')) {
      const session = this.getCurrentSession();
      session.status = 'ai';
      session.messages.push({
        text: 'Dạ Urii đã hủy yêu cầu chuyển admin. Urii Bot sẵn sàng tiếp tục hỗ trợ giải đáp cho bạn nhé! ✨',
        sender: 'bot',
        timestamp: Date.now()
      });
      const sessions = this.getSessions();
      sessions[session.sessionId] = session;
      this.saveSessions(sessions);
      this.messages = this.visibleMessages(session.messages);
      this.updateHeaderStatus('ai');
      this.cdr.detectChanges();
      this.scrollToBottom();

      this.http.post(`/api/chat/sessions/${encodeURIComponent(session.messages.find(m => m.serverSessionId)?.serverSessionId || session.sessionId)}/cancel-agent`, {}).subscribe({
        error: (err) => console.warn('Lỗi gọi cancel-agent:', err)
      });
      return;
    }

    if (['Tư vấn từ nhân viên', 'Gặp tư vấn viên', 'Tư vấn viên', 'Chat với Admin', 'Liên hệ Admin'].includes(action)) {
      this.connectWithAdmin();
      return;
    }

    this.userMessageText = action;
    this.sendMessage();
  }

  private scrollToBottom(): void {
    try {
      setTimeout(() => {
        const chatBody = document.getElementById('chat-body');
        if (chatBody) {
          chatBody.scrollTop = chatBody.scrollHeight;
        }
      }, 50);
    } catch (e) {}
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
