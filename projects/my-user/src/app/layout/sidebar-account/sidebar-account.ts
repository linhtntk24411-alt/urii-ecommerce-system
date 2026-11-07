import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-sidebar-account',
  styleUrl: './sidebar-account.css',
  templateUrl: './sidebar-account.html',
})
export class SidebarAccount {
}
