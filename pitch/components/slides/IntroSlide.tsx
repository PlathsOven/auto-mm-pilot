"use client";


export function IntroSlide() {
  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-2xl mx-auto">
      <p className="text-muted-foreground text-base leading-relaxed text-center max-w-lg">
        A positional trading platform for crypto options market-making desks.
        <br />
        <span className="text-foreground font-medium">
          24/7 Citadel-style positional trading at a fraction of the cost.
        </span>
      </p>

    </div>
  );
}
