import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DialogService, LoginPromptOptions } from '../../core/services/dialog.service';

@Component({
  selector: 'app-global-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-dialog.html',
  styleUrls: ['./global-dialog.css']
})
export class GlobalDialogComponent {
  readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);

  @HostListener('window:keydown.escape', ['$event'])
  handleEscape(event: Event): void {
    if (this.dialogService.currentLoginPrompt()) {
      event.preventDefault();
      this.dialogService.closeLoginPrompt();
      return;
    }
    if (this.dialogService.currentDialog()) {
      event.preventDefault();
      this.dialogService.onCancel();
    }
  }

  @HostListener('window:keydown.enter', ['$event'])
  handleEnter(event: Event): void {
    if (this.dialogService.currentDialog()) {
      event.preventDefault();
      this.dialogService.onConfirm();
    }
  }

  goToLogin(prompt: LoginPromptOptions): void {
    const returnUrl = prompt.returnUrl || this.router.url;
    this.dialogService.closeLoginPrompt();
    void this.router.navigate(['/login'], {
      queryParams: returnUrl ? { returnUrl } : undefined
    });
  }

  goToRegister(prompt: LoginPromptOptions): void {
    const returnUrl = prompt.returnUrl || this.router.url;
    this.dialogService.closeLoginPrompt();
    void this.router.navigate(['/register'], {
      queryParams: returnUrl ? { returnUrl } : undefined
    });
  }
}
