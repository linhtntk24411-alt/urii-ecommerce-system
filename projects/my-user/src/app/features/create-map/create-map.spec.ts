import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreateMapComponent } from './create-map';
import { provideRouter } from '@angular/router';

describe('CreateMapComponent', () => {
  let component: CreateMapComponent;
  let fixture: ComponentFixture<CreateMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateMapComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(CreateMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have default grid size of 29', () => {
    expect(component.gridSize).toBe(29);
  });

  it('should have default color count of 16', () => {
    expect(component.colorCount).toBe(16);
  });

  it('should update grid size when setGridSize is called', () => {
    component.setGridSize(40);
    expect(component.gridSize).toBe(40);
  });
});
