import { useEffect, useRef } from "react";
import { parseScene, type SceneSpec } from "./specs";
import { showBeat } from "./Svg";
import { boxClass, useDraw } from "./useDraw";

/**
 * M83: a 3D scene with three.js (MIT), drawn in the card from declared JSON. Parts show by beat, the camera moves to each beat's
 * view, and the student can drag to turn it. Labels are HTML over the canvas (Hebrew works) on a paper pill.
 */
type Obj = SceneSpec["objects"][number];
const on = (o: { beat?: number; until?: number }, b: number | undefined) => b === undefined || ((o.beat ?? 0) <= b && (o.until ?? Infinity) >= b);

export function Scene({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  const at = useRef(beat);
  const go = useRef<(b: number | undefined) => void>(undefined);
  const ref = useDraw(
    async (el) => {
      const T = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const spec = parseScene(source);
      const css = getComputedStyle(el);
      const ink = css.color;
      const color = (c: Obj["color"]) => new T.Color(c ? (c.startsWith("#") ? c : css.getPropertyValue(`--m-${c}`).trim() || ink) : "#a9adb3");

      const box = el.appendChild(document.createElement("div"));
      box.className = "fig-scene";
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const canvas = box.appendChild(renderer.domElement);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", spec.objects.flatMap((o) => o.label ?? []).join(", ") || "3D");
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(40, 4 / 3, 0.01, 1000);
      scene.add(camera, new T.HemisphereLight("#ffffff", "#80868f", 1.4));
      const sun = new T.DirectionalLight("#ffffff", 2.2);
      sun.position.set(3, 5, 4);
      camera.add(sun); // the light turns with the camera: the side in view is always lit

      const parts: { o: Obj; node: InstanceType<typeof T.Object3D> }[] = [];
      const labels: { el: HTMLElement; p: InstanceType<typeof T.Vector3> }[] = [];
      const v = (a: [number, number, number] | undefined) => new T.Vector3(...(a ?? [0, 0, 0]));
      const size = (o: Obj, k: number, d: number) => (typeof o.size === "number" ? o.size : (o.size?.[k] ?? d));
      /** a rod (cylinder) from a to b */
      const rod = (a: InstanceType<typeof T.Vector3>, b: InstanceType<typeof T.Vector3>, r: number, mat: InstanceType<typeof T.Material>) => {
        const m = new T.Mesh(new T.CylinderGeometry(r, r, a.distanceTo(b), 24), mat);
        m.position.copy(a).lerp(b, 0.5);
        m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        return m;
      };
      const all = new T.Group();
      scene.add(all);
      for (const o of spec.objects) {
        const mat = new T.MeshStandardMaterial({ color: color(o.color), roughness: 0.45, metalness: 0.1, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) === 1, side: o.shape === "plane" ? T.DoubleSide : T.FrontSide });
        const g = new T.Group();
        let tip = v(o.at);
        if (o.shape === "arrow" || o.shape === "line") {
          const r = size(o, 0, o.shape === "arrow" ? 0.04 : 0.02);
          const pts = (o.shape === "line" && o.points ? o.points : [o.from, o.to]).map(v);
          const a = pts[0] ?? v(undefined);
          const b = pts.at(-1) ?? a;
          if (o.shape === "arrow") {
            const head = Math.min(r * 6, a.distanceTo(b) * 0.4);
            const neck = b.clone().sub(a).setLength(a.distanceTo(b) - head).add(a);
            const cone = new T.Mesh(new T.ConeGeometry(r * 2.5, head, 24), mat);
            cone.position.copy(neck).lerp(b, 0.5);
            cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
            g.add(rod(a, neck, r, mat), cone);
          } else pts.slice(1).forEach((p, i) => g.add(rod(pts[i] ?? p, p, r, mat)));
          tip = o.shape === "arrow" ? b : a.clone().lerp(b, 0.5);
        } else if (o.shape === "cylinder" && o.from && o.to) {
          g.add(rod(v(o.from), v(o.to), size(o, 0, 0.5), mat)); // a bond, a rod between two points
          tip = v(o.from).lerp(v(o.to), 0.5);
        } else if (o.shape !== "label") {
          const geo =
            o.shape === "box"
              ? new T.BoxGeometry(size(o, 0, 1), size(o, 1, size(o, 0, 1)), size(o, 2, size(o, 0, 1)))
              : o.shape === "sphere"
                ? new T.SphereGeometry(size(o, 0, 0.5), 48, 32)
                : o.shape === "cylinder"
                  ? new T.CylinderGeometry(size(o, 0, 0.5), size(o, 0, 0.5), size(o, 1, 1), 48)
                  : o.shape === "cone"
                    ? new T.ConeGeometry(size(o, 0, 0.5), size(o, 1, 1), 48)
                    : o.shape === "torus"
                      ? new T.TorusGeometry(size(o, 0, 1), size(o, 1, 0.25), 32, 96)
                      : new T.PlaneGeometry(size(o, 0, 2), size(o, 1, size(o, 0, 2)));
          const m = new T.Mesh(geo, mat);
          if (o.shape === "box") m.add(new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.6 })));
          m.position.copy(tip);
          if (o.rotate) m.rotation.set(...(o.rotate.map((d) => (d * Math.PI) / 180) as [number, number, number]));
          g.add(m);
        }
        all.add(g);
        parts.push({ o, node: g });
        if (o.label) {
          const l = box.appendChild(document.createElement("span"));
          l.className = "fig-scene-label";
          l.dir = "auto";
          l.textContent = o.label;
          if (o.beat) l.dataset.beat = String(o.beat);
          if (o.until) l.dataset.until = String(o.until);
          if (o.color && !o.color.startsWith("#")) l.classList.add(`m-${o.color}`);
          labels.push({ el: l, p: tip });
        }
      }
      // the frame comes from every part, shown or not: hidden parts never reframe the scene
      const ball = new T.Box3().setFromObject(all).getBoundingSphere(new T.Sphere());
      const r = Math.max(ball.radius, 0.5);
      if (spec.grid) {
        const grid = new T.GridHelper(r * 4, 16, ink, ink);
        (grid.material as InstanceType<typeof T.Material>).opacity = 0.18;
        (grid.material as InstanceType<typeof T.Material>).transparent = true;
        grid.position.y = new T.Box3().setFromObject(all).min.y;
        scene.add(grid);
      }
      if (spec.axes)
        for (const [d, name] of [[[1, 0, 0], "x"], [[0, 1, 0], "y"], [[0, 0, 1], "z"]] as const) {
          const end = new T.Vector3(...d).multiplyScalar(r * 1.2);
          scene.add(rod(new T.Vector3(), end, r * 0.006, new T.MeshBasicMaterial({ color: ink })));
          const l = box.appendChild(Object.assign(document.createElement("span"), { className: "fig-scene-label", textContent: name }));
          labels.push({ el: l, p: end.multiplyScalar(1.06) });
        }
      camera.near = r / 100;
      camera.far = r * 100;
      const views = [...(spec.views ?? [])].sort((a, b) => a.beat - b.beat);
      const home = { from: ball.center.clone().add(new T.Vector3(1.1, 0.8, 1.6).setLength(r * 3.2)), to: ball.center.clone() };
      const view = (b: number | undefined) => {
        const w = views.filter((x) => x.beat <= (b ?? 0)).at(-1);
        return w ? { from: v(w.from), to: w.to ? v(w.to) : ball.center.clone() } : home;
      };

      const controls = new OrbitControls(camera, canvas); // never listenToKeyEvents: the arrow keys step the beats
      controls.enableZoom = false;
      controls.enablePan = false;
      const render = () => {
        renderer.render(scene, camera);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        for (const { el: l, p } of labels) {
          const s = p.clone().project(camera);
          l.style.left = `${((s.x + 1) / 2) * w}px`;
          l.style.top = `${((1 - s.y) / 2) * h}px`;
        }
      };
      controls.addEventListener("change", render);
      const fit = () => {
        const w = box.clientWidth;
        renderer.setSize(w, (w * 3) / 4, false);
        render();
      };
      const ro = new ResizeObserver(fit);
      ro.observe(box);

      let raf = 0;
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const place = (b: number | undefined, first = false) => {
        for (const { o, node } of parts) node.visible = on(o, b);
        showBeat(box, b);
        const { from, to } = view(b);
        cancelAnimationFrame(raf);
        const p0 = camera.position.clone();
        const t0 = controls.target.clone();
        const start = performance.now();
        const step = () => {
          const k = first || still ? 1 : Math.min(1, (performance.now() - start) / 700);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          camera.position.lerpVectors(p0, from, e);
          controls.target.lerpVectors(t0, to, e);
          controls.update();
          render();
          if (k < 1) raf = requestAnimationFrame(step);
        };
        step();
      };
      go.current = place;
      fit();
      place(at.current, true);
      return () => {
        go.current = undefined;
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        scene.traverse((n) => {
          const m = n as InstanceType<typeof T.Mesh>;
          m.geometry?.dispose();
          for (const x of [m.material].flat()) (x as InstanceType<typeof T.Material> | undefined)?.dispose();
        });
        renderer.dispose();
        renderer.forceContextLoss(); // browsers cap live WebGL contexts, and a lesson keeps many cards
      };
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    go.current?.(beat);
  }, [beat]);
  return <div ref={ref} className={`${boxClass} fig-svg`} dir="ltr" />;
}
