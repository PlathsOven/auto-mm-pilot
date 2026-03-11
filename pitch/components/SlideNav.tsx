"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { slides } from "@/lib/slides";

interface SlideNavProps {
  currentSlide: number;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (index: number) => void;
}

export function SlideNav({ currentSlide, onPrev, onNext, onGoTo }: SlideNavProps) {
  const total = slides.length;
  const isFirst = currentSlide === 0;
  const isLast = currentSlide === total - 1;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-muted bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
        {/* Prev button */}
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </button>

        {/* Progress dots + labels */}
        <div className="flex items-center gap-1">
          {slides.map((slide, i) => (
            <div key={slide.id} className="flex items-center">
              {i > 0 && (
                <div className="h-6 w-px bg-muted-foreground/20 mx-1.5" />
              )}
              <button
                onClick={() => onGoTo(i)}
                className="group flex flex-col items-center gap-1 px-1"
                aria-label={`Go to slide: ${slide.title}`}
              >
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === currentSlide
                      ? "w-6 bg-[var(--brand)]"
                      : "w-2 bg-muted-foreground/40 group-hover:bg-muted-foreground"
                  }`}
                />
                <span
                  className={`text-[10px] transition-colors hidden sm:block ${
                    i === currentSlide
                      ? "text-foreground font-medium"
                      : "text-muted-foreground/60 group-hover:text-muted-foreground"
                  }`}
                >
                  {slide.title}
                </span>
              </button>
            </div>
          ))}
        </div>

        {/* Next button */}
        <button
          onClick={onNext}
          disabled={isLast}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next slide"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
