import heroAttackDownUrl from "../../assets/characters/hero/attack/mirishira-hero-attack-down-512x512.png";
import heroAttackLeftUrl from "../../assets/characters/hero/attack/mirishira-hero-attack-left-512x512.png";
import heroAttackRightUrl from "../../assets/characters/hero/attack/mirishira-hero-attack-right-512x512.png";
import heroAttackUpUrl from "../../assets/characters/hero/attack/mirishira-hero-attack-up-512x512.png";
import heroDownUrl from "../../assets/characters/hero/mirishira-hero-down-384x384.png";
import heroLeftUrl from "../../assets/characters/hero/mirishira-hero-left-384x384.png";
import heroRightUrl from "../../assets/characters/hero/mirishira-hero-right-384x384.png";
import heroUpUrl from "../../assets/characters/hero/mirishira-hero-up-384x384.png";
import wallLowUrl from "../../assets/tiles/mirishira-wall-low-256x352.png";

export type HeroDirection = "up" | "down" | "left" | "right";

type DirectionalImages = Record<HeroDirection, HTMLImageElement>;

export interface GameAssets {
  wallLow: HTMLImageElement;
  hero: {
    idle: DirectionalImages;
    attack: DirectionalImages;
  };
}

export async function loadGameAssets(): Promise<GameAssets> {
  const [
    wallLow,
    heroUp,
    heroDown,
    heroLeft,
    heroRight,
    heroAttackUp,
    heroAttackDown,
    heroAttackLeft,
    heroAttackRight,
  ] = await Promise.all([
    loadImage(wallLowUrl),
    loadImage(heroUpUrl),
    loadImage(heroDownUrl),
    loadImage(heroLeftUrl),
    loadImage(heroRightUrl),
    loadImage(heroAttackUpUrl),
    loadImage(heroAttackDownUrl),
    loadImage(heroAttackLeftUrl),
    loadImage(heroAttackRightUrl),
  ]);

  return {
    wallLow,
    hero: {
      idle: {
        up: heroUp,
        down: heroDown,
        left: heroLeft,
        right: heroRight,
      },
      attack: {
        up: heroAttackUp,
        down: heroAttackDown,
        left: heroAttackLeft,
        right: heroAttackRight,
      },
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
