import heroDownUrl from "../../assets/characters/hero/mirishira-hero-down-384x384.png";
import heroLeftUrl from "../../assets/characters/hero/mirishira-hero-left-384x384.png";
import heroRightUrl from "../../assets/characters/hero/mirishira-hero-right-384x384.png";
import heroUpUrl from "../../assets/characters/hero/mirishira-hero-up-384x384.png";
import wallLowUrl from "../../assets/tiles/mirishira-wall-low-256x352.png";

export type HeroDirection = "up" | "down" | "left" | "right";

export interface GameAssets {
  wallLow: HTMLImageElement;
  hero: Record<HeroDirection, HTMLImageElement>;
}

export async function loadGameAssets(): Promise<GameAssets> {
  const [wallLow, heroUp, heroDown, heroLeft, heroRight] = await Promise.all([
    loadImage(wallLowUrl),
    loadImage(heroUpUrl),
    loadImage(heroDownUrl),
    loadImage(heroLeftUrl),
    loadImage(heroRightUrl),
  ]);

  return {
    wallLow,
    hero: {
      up: heroUp,
      down: heroDown,
      left: heroLeft,
      right: heroRight,
    },
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`Could not load image: ${source}`)),
      { once: true },
    );
    image.src = source;
  });
}
