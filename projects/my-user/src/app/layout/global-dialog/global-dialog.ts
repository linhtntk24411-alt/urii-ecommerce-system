import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../core/services/dialog.service';

@Component({
  selector: 'app-global-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-dialog.html',
  styleUrls: ['./global-dialog.css']
})
export class GlobalDialogComponent {
  readonly dialogService = inject(DialogService);

  @HostListener('window:keydown.escape', ['$event'])
  handleEscape(event: Event): void {
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
}
