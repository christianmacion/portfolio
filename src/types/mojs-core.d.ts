/**
 * mojs-core.d.ts : minimal ambient declarations for @mojs/core UMD build.
 *
 * The mojs package only ships a single UMD file (no types). We declare
 * the subset used by [[scripts/motion/mojs-recipes.client.ts]] so that
 * astro check + IDE intellisense don't choke. Library is dynamically
 * imported at runtime; the surface area is intentionally narrow.
 */
declare module '@mojs/core' {
  export class Burst {
    constructor(opts: Record<string, unknown>);
    play(): void;
  }
  export class Shape {
    constructor(opts: Record<string, unknown>);
  }
  export class Html {
    constructor(opts: Record<string, unknown>);
  }
  export class MotionPath {
    constructor(opts: Record<string, unknown>);
  }
  export class Tween {
    constructor(opts: Record<string, unknown>);
  }
  export class Timeline {
    constructor(opts: Record<string, unknown>);
  }
  const mojs: {
    Burst: typeof Burst;
    Shape: typeof Shape;
    Html: typeof Html;
    MotionPath: typeof MotionPath;
    Tween: typeof Tween;
    Timeline: typeof Timeline;
  };
  export default mojs;
}
