import {
  ACESFilmicToneMapping,
  AmbientLight,
  DepthTexture,
  DirectionalLight,
  HalfFloatType,
  PMREMGenerator,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CameraRig } from "./camera";
import { FOCUS_FORWARD_OFFSET, FocusPass } from "./focus-pass";
import { LoopMesh } from "./mesh";
import { qualityFor } from "./quality";

export type SceneSection = "hero" | "research" | "product" | "about";

export interface SceneController {
  /** Continuous panel position, e.g. 1.4 is 40% of the way from panel 2 to 3. */
  setProgress(progress: number): void;
  setSection(section: SceneSection): void;
  /**
   * A page turn just started. Called once, at the start of the slide, because
   * `setProgress` only sees one frame of it at a time: a 550 ms ease is twenty
   * small steps, and a boost sized from a single step is no boost at all.
   */
  pageTurn(): void;
  dispose(): void;
}

export function createScene(
  host: HTMLElement,
  onFailure: () => void,
  options: { still?: boolean } = {},
): SceneController {
  let quality = qualityFor(window.innerWidth, window.devicePixelRatio);
  host.dataset.quality = quality.mobile ? "mobile" : "desktop";
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.debug.onShaderError = () => {
    throw new Error("The lattice shader is unavailable on this device.");
  };
  const scene = new Scene();
  // The environment map carries ambient fill; the directionals only shape the
  // form and put a cool rim on the far side of the tube.
  const ambient = new AmbientLight(0x9eaaa5, 0.72);
  const key = new DirectionalLight(0xffedda, 2.8);
  key.position.set(-3, 5, 6);
  const rim = new DirectionalLight(0xb5d5ed, 2.3);
  rim.position.set(4, -2, 3);
  scene.add(ambient, key, rim);

  const camera = new CameraRig();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine)");
  let loop = new LoopMesh(quality);
  scene.add(loop.group);

  // Node and bond counts, for the page-level check only: a honeycomb closed on
  // a torus has exactly 1.5 bonds per node, and anything less is a seam where
  // atoms ended up unconnected.
  function markLattice() {
    host.dataset.lattice = `${loop.lattice.nodes.length}:${loop.lattice.edges.length}`;
  }
  markLattice();
  host.append(renderer.domElement);
  host.dataset.canvasReady = "false";
  host.dataset.renderer = "pending";

  let composer: EffectComposer | undefined;
  let bloomPass: UnrealBloomPass | undefined;
  let focusPass: FocusPass | undefined;
  let outputPass: OutputPass | undefined;
  let composerReady = false;
  let disposed = false;
  let visible = true;
  let section: SceneSection = "hero";
  let frame = 0;
  let lastFrame = 0;
  let seconds = 0;
  let ready = false;
  let enhancementsScheduled = false;
  let lastProgress = 0;
  // Wall clock, in milliseconds. The scene's own `seconds` only advances by
  // rendered frames, which a slow machine stretches far beyond real time.
  let lastNudge = -1e6;

  function bakeEnvironment() {
    if (disposed || scene.environment) return;
    try {
      const pmrem = new PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const env = pmrem.fromScene(room, 0.015).texture;
      room.traverse((object) => {
        const mesh = object as {
          geometry?: { dispose(): void };
          material?: { dispose(): void };
        };
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      pmrem.dispose();
      if (disposed) {
        env.dispose();
        return;
      }
      scene.environment = env;
      ambient.intensity = 0.2;
    } catch {
      // Directional lights alone still describe the form if the bake fails.
    }
  }

  function disposeComposer() {
    focusPass?.dispose();
    focusPass = undefined;
    bloomPass?.dispose();
    bloomPass = undefined;
    outputPass?.dispose();
    outputPass = undefined;
    composer?.dispose();
    composer = undefined;
    composerReady = false;
    host.dataset.enhanced = "false";
    host.dataset.focus = "pending";
  }

  function ensureComposer(width: number, height: number) {
    if (composer || disposed) return;
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, {
      type: HalfFloatType,
      depthTexture: new DepthTexture(size.x, size.y),
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera.camera));
    focusPass = new FocusPass();
    composer.addPass(focusPass);
    if (!quality.mobile) {
      bloomPass = new UnrealBloomPass(new Vector2(width, height), 0.08, 0.3, 0.92);
      composer.addPass(bloomPass);
    }
    outputPass = new OutputPass();
    composer.addPass(outputPass);
    composer.setPixelRatio(quality.pixelRatio);
    composer.setSize(width, height);
    composerReady = true;
    host.dataset.focus = quality.mobile ? "mobile" : "desktop";
  }

  function syncComposer(width: number, height: number) {
    if (!composer) {
      composerReady = false;
      return;
    }
    composer.setPixelRatio(quality.pixelRatio);
    composer.setSize(width, height);
  }

  function scheduleEnhancements() {
    if (enhancementsScheduled) return;
    enhancementsScheduled = true;
    requestAnimationFrame(() => {
      enhancementsScheduled = false;
      if (disposed || !ready) return;
      const { width, height } = host.getBoundingClientRect();
      ensureComposer(width, height);
      bakeEnvironment();
      if (ready && visible && !document.hidden) draw();
      host.dataset.canvasReady = "true";
      host.dataset.renderer = "webgl";
      host.dataset.enhanced = "true";
      if (running() && !frame) frame = requestAnimationFrame(animate);
    });
  }

  function draw(delta = 0, snap = false) {
    const frozen = snap || Boolean(options.still) || reducedMotion.matches;
    camera.update(seconds, delta, frozen);
    if (composerReady && composer && focusPass) {
      focusPass.setFocus(
        camera.focusDistance - FOCUS_FORWARD_OFFSET,
        camera.camera.near,
        camera.camera.far,
      );
      composer.render();
    } else {
      renderer.render(scene, camera.camera);
    }
  }

  function running() {
    return (
      ready &&
      !disposed &&
      !options.still &&
      !reducedMotion.matches &&
      !document.hidden &&
      visible &&
      // On a phone the figure only exists behind the first panel; once the
      // copy has scrolled over it there is nothing to redraw.
      (!quality.mobile || section === "hero")
    );
  }

  function animate(now: number) {
    if (!running()) {
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(animate);
    // Allow a few milliseconds of slack. The budget sits on a vsync boundary,
    // and a browser that reports 33.32 ms for a frame it promised at 33.33
    // loses the comparison — so a 30 fps target silently becomes 20, every
    // third refresh, forever.
    if (now - lastFrame < 1000 / quality.fps - 5) return;
    const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.08) : 0;
    lastFrame = now;
    seconds += delta;
    loop.update(seconds);
    // Two numbers for the page-level check: where the pattern is, and how fast
    // it is running. Neither is rendered — they exist so a test can tell a
    // crawling figure from a frozen one.
    host.dataset.crawl = loop.crawlPhase.toFixed(4);
    host.dataset.crawlSpeed = loop.crawlRate.toFixed(4);
    draw(delta);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    if (disposed) return;
    if (ready && visible && !document.hidden) draw(0, true);
    if (running()) frame = requestAnimationFrame(animate);
  }

  function resize() {
    if (disposed) return;
    const next = qualityFor(window.innerWidth, window.devicePixelRatio);
    if (next.mobile !== quality.mobile) {
      const state = loop.captureState();
      scene.remove(loop.group);
      loop.dispose();
      loop = new LoopMesh(next);
      loop.restoreState(state, seconds);
      scene.add(loop.group);
      markLattice();
      disposeComposer();
    }
    quality = next;
    host.dataset.quality = quality.mobile ? "mobile" : "desktop";
    renderer.setPixelRatio(quality.pixelRatio);
    loop.setPixelRatio(quality.pixelRatio);
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.resize(width, height, quality.mobile);
    syncComposer(width, height);
    if (!composer) scheduleEnhancements();
    sync();
  }

  function pointer(event: PointerEvent) {
    if (!quality.mobile && finePointer.matches && !reducedMotion.matches) {
      camera.point(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1),
      );
    }
  }
  function resetPointer() {
    camera.point(0, 0);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    dispose();
    onFailure();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      sync();
    },
    { threshold: 0 },
  );
  intersection.observe(host);
  window.addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("pointerleave", resetPointer);
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersection.disconnect();
    window.removeEventListener("pointermove", pointer);
    document.removeEventListener("pointerleave", resetPointer);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", sync);
    reducedMotion.removeEventListener("change", sync);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    loop.dispose();
    disposeComposer();
    host.dataset.canvasReady = "false";
    host.dataset.renderer = "static";
    scene.environment?.dispose();
    scene.environment = null;
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  try {
    resize();
    ready = true;
  } catch (error) {
    dispose();
    throw error;
  }
  scheduleEnhancements();
  return {
    pageTurn() {
      host.dataset.turn = String(Number(host.dataset.turn ?? 0) + 1);
      const now = performance.now();
      if (!ready || now - lastNudge < 450) return;
      lastNudge = now;
      loop.nudge(1);
    },
    setProgress(value) {
      // The fallback for turns nobody announced: a scroll jump on a phone, or a
      // drag that was let go. It has to be a real step, not a frame of a slide,
      // or the pattern would surge all the way through every animation.
      const travel = Math.abs(value - lastProgress);
      lastProgress = value;
      const now = performance.now();
      // A wider window than a page turn's own: when frames are slow, the first
      // frame of the slide can already cover half a panel and look like a
      // scroll jump, which would double the impulse on the same turn.
      if (travel > 0.35 && ready && now - lastNudge > 700) {
        lastNudge = now;
        loop.nudge(1);
      }
      camera.setProgress(value);
      // While the loop is running it picks the new framing up on the next
      // frame. Otherwise this is a paused scene and needs one draw.
      if (!quality.mobile && !running()) sync();
    },
    setSection(value) {
      section = value;
      sync();
    },
    dispose,
  };
}
