import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  imports: [],
  selector: 'app-about',
  templateUrl: './about.html',
})
export class About {
  private readonly router = inject(Router);

  exploreProducts(): void {
    void this.router.navigate(['/products']);
  }

  scrollToStory(): void {
    const storyEl = document.getElementById('story-title');
    storyEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
