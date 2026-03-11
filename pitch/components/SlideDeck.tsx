"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { slides } from "@/lib/slides";
import { SlideNav } from "@/components/SlideNav";

export function SlideDeck() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward

  const goNext = useCallback(() => {
    setCurrentSlide((prev) => {
      if (prev >= slides.length - 1) return prev;
      setDirection(1);
      return prev + 1;
    });
  }, []);

  const goPrev = useCallback(() => {
    setCurrentSlide((prev) => {
      if (prev <= 0) return prev;
      setDirection(-1);
      return prev - 1;
    });
  }, []);

  const goTo = useCallback((index: number) => {
    setCurrentSlide((prev) => {
      if (index < 0 || index >= slides.length || index === prev) return prev;
      setDirection(index > prev ? 1 : -1);
      return index;
    });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev]);

  const slide = slides[currentSlide];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-muted">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-[var(--brand)] flex items-center justify-center">
            <span className="text-xs font-bold text-background leading-none">A</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            APT: Automated Positional Trader
          </span>
        </div>
        <span className="text-sm font-medium text-muted-foreground tabular-nums">
          {currentSlide + 1} / {slides.length}
        </span>
      </header>

      {/* Slide content area — centered both axes */}
      <div className="flex-1 overflow-y-auto px-6 pb-24">
        <div className="min-h-full flex items-center justify-center py-8">
          <div className="max-w-5xl w-full">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide.id}
                custom={direction}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="flex flex-col items-center"
              >
                {/* Slide title */}
                <h1 className="text-3xl font-bold tracking-tight mb-6 text-center">
                  {slide.title}
                </h1>

                {/* Slide content (React component) */}
                <div className="w-full">
                  {slide.content}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Bottom navigation */}
      <SlideNav
        currentSlide={currentSlide}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={goTo}
      />
    </div>
  );
}
