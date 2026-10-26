import { PerspectiveCamera, Vector2 } from "three";
import {
  LOOP_HALF_HEIGHT,
  LOOP_HALF_WIDTH,
  focusAt,
  type Frame,
} from "./frames";

const DEG = Math.PI / 180;
const FIT = 1.06;

export class CameraRig {
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 60);
  private readonly pointer = new Vector2();
  private readonly current = new Vector2();
  private shot: Frame = focusAt(0);
  // The lens is aimed by hand rather than at the origin: aiming at the shot's
  // target is what turns a lateral move into a crop of a much larger object.
  private aimX = this.shot.x;
  private aimY = this.shot.y;
  private mobile = false;
  private distance = 12;
  /** Distance from the lens to the plane it is aimed at, for the focus pass. */
  focusDistance = 12;

  get frame(): Frame {
    return this.shot;
  }

  resize(width: number, height: number, mobile: boolean) {
    this.mobile = mobile;
    const aspect = width / Math.max(height, 1);
    this.camera.aspect = aspect;
    const tangent = Math.tan((this.camera.fov * DEG) / 2);
    const byHeight = LOOP_HALF_HEIGHT / tangent;
    const byWidth = LOOP_HALF_WIDTH / (tangent * aspect);
    this.distance = Math.max(byHeight, byWidth) * FIT;
    this.camera.updateProjectionMatrix();
    // Crossing the phone breakpoint changes what a "frame" means; re-resolve it.
    this.setProgress(this.progress);
  }

  private progress = 0;

  /**
   * A phone gets one framing: the stage is a short band under the copy, so
   * travel between crops would happen off-screen.
   */
  setProgress(progress: number) {
    this.progress = progress;
    this.shot = this.mobile ? { x: 0, y: 0.02, zoom: 0.63 } : focusAt(progress);
  }

  point(x: number, y: number) {
    this.pointer.set(x, y);
  }

  update(seconds: number, delta: number, still: boolean) {
    const active = !this.mobile && !still;
    const weight = 1 - Math.exp(-delta * 5.5);
    this.current.x += ((active ? this.pointer.x : 0) - this.current.x) * (still ? 1 : weight);
    this.current.y += ((active ? this.pointer.y : 0) - this.current.y) * (still ? 1 : weight);

    const time = still ? 0 : seconds;
    const amplitude = this.mobile ? 0.35 : 1;
    // The drift used to be half a world unit. At this crop it has to be a
    // fraction of that, or the framing walks away from the panel it belongs to.
    const targetX =
      this.shot.x +
      Math.sin(time * 0.19) * 0.13 * amplitude +
      this.current.x * 0.2;
    const targetY =
      this.shot.y +
      Math.sin(time * 0.15) * 0.09 * amplitude +
      this.current.y * 0.11;

    this.aimX += (targetX - this.aimX) * (still ? 1 : weight);
    this.aimY += (targetY - this.aimY) * (still ? 1 : weight);

    const breathe =
      1 + (Math.sin(time * 0.18 + 0.4) - Math.sin(0.4)) * 0.012 * amplitude;
    this.focusDistance = this.distance * this.shot.zoom;
    this.camera.position.set(this.aimX, this.aimY, this.focusDistance * breathe);
    this.camera.lookAt(this.aimX, this.aimY, 0);
  }
}
