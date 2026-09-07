"use client";

import { useEffect, useRef } from "react";

/**
 * The home hero's only animation: a line diagram of the business motion.
 *
 * Unordered platform supply drifts on the left, transits a review gate in the
 * middle, and seats into an exact catalog lattice on the right. Supply that
 * fails review is deflected at the gate, rises and rejoins the cloud — it never
 * reaches the lattice. Seated products periodically emit a call packet and
 * return to the cloud, so the lattice keeps turning over instead of filling up.
 *
 * three.js is imported dynamically so it stays out of every other page's bundle,
 * and the whole effect is skipped for reduced-motion users and when WebGL is
 * unavailable — the page reads correctly against the plain ground either way.
 */

const CLUSTERS = 24;
const LAT_LAYERS = 4;
const LAT_ROWS = 7;
const LAT_COLS = 6;
const GATE_X = -0.62;
const PACKET_COUNT = 90;
// Share of transits the gate turns away. Deliberately uniform across clusters:
// the diagram claims that some supply is deflected, not which platform's is.
const DEFLECT_RATE = 0.22;

type Particle = {
  cluster: number;
  phase: 0 | 1 | 2 | 3;
  seat: number;
  t: number;
  wait: number;
  fire: number;
  reject: boolean;
};

export function HeroFlow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Below this width the hero copy sits directly over the diagram instead of
    // beside it, so the animation would only make the text harder to read. Bail
    // out before the dynamic import so narrow viewports never fetch three.js.
    if (window.matchMedia("(max-width: 1100px)").matches) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const THREE = await import("three");
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
        });
      } catch {
        // No WebGL (old browser, blocked context, headless). Stay static.
        return;
      }
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
      camera.position.set(2.3, 1.0, 6.15);
      camera.lookAt(-0.3, 0.24, 0);

      const world = new THREE.Group();
      world.rotation.y = -0.2;
      world.rotation.z = 0.34;
      world.scale.setScalar(0.68);
      scene.add(world);

      const disposables: { dispose: () => void }[] = [];
      const track = <T extends { dispose: () => void }>(item: T) => {
        disposables.push(item);
        return item;
      };
      const hairline = (color: number, opacity: number) =>
        track(
          new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
        );

      // Left: one loosely bound drift cluster per platform of supply.
      const clusters: import("three").Vector3[] = [];
      for (let i = 0; i < CLUSTERS; i += 1) {
        const a = (i / CLUSTERS) * Math.PI * 2 * 1.7;
        const rr = 0.5 + (i % 3) * 0.44;
        clusters.push(
          new THREE.Vector3(
            -1.95 - (i % 4) * 0.25,
            Math.sin(a) * rr * 1.05,
            Math.cos(a) * rr * 0.92,
          ),
        );
      }

      // Right: an exact lattice of catalog seats.
      const seats: import("three").Vector3[] = [];
      const seatOwner: number[] = [];
      const guidePoints: import("three").Vector3[] = [];
      for (let lx = 0; lx < LAT_LAYERS; lx += 1) {
        for (let ry = 0; ry < LAT_ROWS; ry += 1) {
          for (let cz = 0; cz < LAT_COLS; cz += 1) {
            seats.push(
              new THREE.Vector3(
                0.42 + lx * 0.53,
                -1.3 + ry * 0.435,
                -0.94 + cz * 0.375,
              ),
            );
            seatOwner.push(-1);
          }
          guidePoints.push(
            new THREE.Vector3(0.42 + lx * 0.53, -1.3 + ry * 0.435, -0.94),
            new THREE.Vector3(
              0.42 + lx * 0.53,
              -1.3 + ry * 0.435,
              -0.94 + (LAT_COLS - 1) * 0.375,
            ),
          );
        }
      }
      world.add(
        new THREE.LineSegments(
          track(new THREE.BufferGeometry().setFromPoints(guidePoints)),
          hairline(0xf2f4f5, 0.055),
        ),
      );

      // Catalog boundary: a hairline box around the lattice.
      const box = new THREE.LineSegments(
        track(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(
              (LAT_LAYERS - 1) * 0.53 + 0.5,
              (LAT_ROWS - 1) * 0.435 + 0.42,
              (LAT_COLS - 1) * 0.375 + 0.4,
            ),
          ),
        ),
        hairline(0xf2f4f5, 0.09),
      );
      box.position.set(0.42 + ((LAT_LAYERS - 1) * 0.53) / 2, 0, 0);
      world.add(box);

      // The review gate: a hairline frame in the YZ plane, corner-ticked in
      // signal green, with a scan bar sweeping it.
      const gate = new THREE.Group();
      gate.position.x = GATE_X;
      const gateH = 1.62;
      const gateD = 1.22;
      gate.add(
        new THREE.LineLoop(
          track(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(0, -gateH, -gateD),
              new THREE.Vector3(0, -gateH, gateD),
              new THREE.Vector3(0, gateH, gateD),
              new THREE.Vector3(0, gateH, -gateD),
            ]),
          ),
          hairline(0xf2f4f5, 0.3),
        ),
      );
      for (const [cy, cz] of [
        [-gateH, -gateD],
        [-gateH, gateD],
        [gateH, gateD],
        [gateH, -gateD],
      ]) {
        const sy = Math.sign(cy);
        const sz = Math.sign(cz);
        gate.add(
          new THREE.LineSegments(
            track(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, cy, cz),
                new THREE.Vector3(0, cy - sy * 0.22, cz),
                new THREE.Vector3(0, cy, cz),
                new THREE.Vector3(0, cy, cz - sz * 0.22),
              ]),
            ),
            hairline(0x5ee39b, 0.9),
          ),
        );
      }
      const scanBar = new THREE.Line(
        track(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, -gateD),
            new THREE.Vector3(0, 0, gateD),
          ]),
        ),
        hairline(0x5ee39b, 0.55),
      );
      gate.add(scanBar);
      const sheet = new THREE.Mesh(
        track(new THREE.PlaneGeometry(gateD * 2, gateH * 2)),
        track(
          new THREE.MeshBasicMaterial({
            color: 0x5ee39b,
            transparent: true,
            opacity: 0.028,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      sheet.rotation.y = Math.PI / 2;
      gate.add(sheet);
      world.add(gate);

      // Baseline rule with ticks — the instrument detail under the diagram.
      const rulePoints = [
        new THREE.Vector3(-3.0, -1.95, 0),
        new THREE.Vector3(2.35, -1.95, 0),
      ];
      for (let x = -2.85; x <= 2.35; x += 0.3) {
        rulePoints.push(
          new THREE.Vector3(x, -1.95, 0),
          new THREE.Vector3(x, -1.87, 0),
        );
      }
      world.add(
        new THREE.LineSegments(
          track(new THREE.BufferGeometry().setFromPoints(rulePoints)),
          hairline(0xf2f4f5, 0.075),
        ),
      );

      const total = seats.length + 190;
      const parts: Particle[] = [];
      const partPos: import("three").Vector3[] = [];
      const partVel: import("three").Vector3[] = [];
      const partFrom: import("three").Vector3[] = [];
      const partMid: import("three").Vector3[] = [];
      for (let i = 0; i < total; i += 1) {
        parts.push({
          cluster: i % CLUSTERS,
          phase: 0,
          seat: -1,
          t: 0,
          wait: Math.random() * 5,
          fire: 0,
          reject: false,
        });
        partPos.push(
          clusters[i % CLUSTERS]
            .clone()
            .add(
              new THREE.Vector3()
                .randomDirection()
                .multiplyScalar(Math.random() * 0.5),
            ),
        );
        partVel.push(new THREE.Vector3().randomDirection().multiplyScalar(0.1));
        partFrom.push(new THREE.Vector3());
        partMid.push(new THREE.Vector3());
      }
      const partGeo = track(new THREE.BufferGeometry());
      partGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3),
      );
      partGeo.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3),
      );
      world.add(
        new THREE.Points(
          partGeo,
          track(
            new THREE.PointsMaterial({
              size: 0.088,
              vertexColors: true,
              transparent: true,
              opacity: 0.96,
              sizeAttenuation: true,
            }),
          ),
        ),
      );

      // Call packets leaving seated products, headed downstream.
      const packets = Array.from({ length: PACKET_COUNT }, () => ({
        on: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        life: 0,
      }));
      const packetGeo = track(new THREE.BufferGeometry());
      packetGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          new Float32Array(PACKET_COUNT * 3).fill(9999),
          3,
        ),
      );
      world.add(
        new THREE.Points(
          packetGeo,
          track(
            new THREE.PointsMaterial({
              color: 0x5ee39b,
              size: 0.078,
              transparent: true,
              opacity: 0.95,
              sizeAttenuation: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          ),
        ),
      );

      function claimSeat() {
        const n = seatOwner.length;
        const start = Math.floor(Math.random() * n);
        for (let k = 0; k < n; k += 1) {
          const i = (start + k) % n;
          if (seatOwner[i] === -1) return i;
        }
        return -1;
      }

      function emitPacket(from: import("three").Vector3) {
        for (const packet of packets) {
          if (packet.on) continue;
          packet.on = true;
          packet.p.copy(from);
          packet.v.set(
            1.7 + Math.random() * 0.6,
            (Math.random() - 0.5) * 0.28,
            (Math.random() - 0.5) * 0.28,
          );
          packet.life = 1.05;
          return;
        }
      }

      const resize = () => {
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        // Pin the diagram to a screen fraction so it clears the readout panel
        // at any viewport width rather than sliding under it.
        const halfH = Math.tan(((44 / 2) * Math.PI) / 180) * 6.7;
        const halfW = halfH * camera.aspect;
        world.position.x = -0.3 + (2 * 0.71 - 1) * halfW + 0.221;
        world.position.y = 0.24 + (1 - 2 * 0.3) * halfH + 0.078;
      };
      resize();
      window.addEventListener("resize", resize);

      const clock = new THREE.Clock();
      const scratch = new THREE.Vector3();
      let raf = 0;

      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;

        world.rotation.x +=
          (Math.sin(t * 0.19) * 0.018 - world.rotation.x) * 0.03;
        scanBar.position.y = Math.sin(t * 0.85) * gateH * 0.94;

        const pos = partGeo.getAttribute("position").array as Float32Array;
        const col = partGeo.getAttribute("color").array as Float32Array;

        for (let i = 0; i < parts.length; i += 1) {
          const q = parts[i];
          const p = partPos[i];
          const v = partVel[i];

          if (q.phase === 0) {
            // Drift, loosely bound to this particle's supply cluster.
            scratch.copy(clusters[q.cluster]).sub(p).multiplyScalar(0.9);
            v.addScaledVector(scratch, dt);
            v.x += (Math.random() - 0.5) * dt * 1.5;
            v.y += (Math.random() - 0.5) * dt * 1.5;
            v.z += (Math.random() - 0.5) * dt * 1.5;
            v.multiplyScalar(0.965);
            p.addScaledVector(v, dt);
            q.wait -= dt;
            if (q.wait <= 0) {
              const seatIndex = claimSeat();
              if (seatIndex >= 0) {
                seatOwner[seatIndex] = i;
                q.seat = seatIndex;
                q.phase = 1;
                q.t = 0;
                q.reject = Math.random() < DEFLECT_RATE;
                partFrom[i].copy(p);
                const seat = seats[seatIndex];
                partMid[i].set(GATE_X, seat.y * 0.55, seat.z * 0.55);
              } else {
                q.wait = 0.4 + Math.random();
              }
            }
          } else if (q.phase === 1) {
            // Transit: cluster → gate → seat, along a quadratic bezier.
            q.t += dt * 0.42;
            const seat = seats[q.seat];
            const u = Math.min(q.t, 1);
            const iu = 1 - u;
            const from = partFrom[i];
            const mid = partMid[i];
            p.set(
              iu * iu * from.x + 2 * iu * u * mid.x + u * u * seat.x,
              iu * iu * from.y + 2 * iu * u * mid.y + u * u * seat.y,
              iu * iu * from.z + 2 * iu * u * mid.z + u * u * seat.z,
            );
            if (q.reject && p.x >= GATE_X) {
              // Deflected at the gate — never enters the catalog.
              seatOwner[q.seat] = -1;
              q.seat = -1;
              q.phase = 3;
              q.t = 1;
              v.set(-0.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.2);
            } else if (q.t >= 1) {
              q.phase = 2;
              p.copy(seat);
              q.fire = 1.5 + Math.random() * 6;
            }
          } else if (q.phase === 2) {
            // Seated: a listed, callable data product.
            q.fire -= dt;
            if (q.fire <= 0) {
              emitPacket(p);
              seatOwner[q.seat] = -1;
              q.seat = -1;
              q.phase = 0;
              q.wait = 1.5 + Math.random() * 6;
              v.set(0, 0, 0);
              p.copy(clusters[q.cluster]).add(
                new THREE.Vector3().randomDirection().multiplyScalar(0.35),
              );
            }
          } else {
            // Rejected: drifts up, fades, then rejoins the unordered cloud.
            v.y -= dt * 0.7;
            p.addScaledVector(v, dt);
            q.t -= dt * 0.7;
            if (q.t <= 0) {
              q.phase = 0;
              q.wait = 1 + Math.random() * 4;
              p.copy(clusters[q.cluster]).add(
                new THREE.Vector3().randomDirection().multiplyScalar(0.4),
              );
              v.set(0, 0, 0);
            }
          }

          pos[i * 3] = p.x;
          pos[i * 3 + 1] = p.y;
          pos[i * 3 + 2] = p.z;

          let r: number;
          let g: number;
          let b: number;
          if (q.phase === 3) {
            [r, g, b] = [0.96, 0.71, 0.27];
          } else if (q.phase === 2) {
            [r, g, b] = [0.95, 0.96, 0.96];
          } else if (q.phase === 1) {
            [r, g, b] = [0.37, 0.89, 0.61];
          } else {
            [r, g, b] = [0.44, 0.47, 0.5];
          }
          col[i * 3] = r;
          col[i * 3 + 1] = g;
          col[i * 3 + 2] = b;
        }
        partGeo.getAttribute("position").needsUpdate = true;
        partGeo.getAttribute("color").needsUpdate = true;

        const packetPos = packetGeo.getAttribute("position")
          .array as Float32Array;
        for (let i = 0; i < packets.length; i += 1) {
          const packet = packets[i];
          if (packet.on) {
            packet.p.addScaledVector(packet.v, dt);
            packet.life -= dt;
            if (packet.life <= 0) packet.on = false;
          }
          const at = packet.on ? packet.p : null;
          packetPos[i * 3] = at ? at.x : 9999;
          packetPos[i * 3 + 1] = at ? at.y : 9999;
          packetPos[i * 3 + 2] = at ? at.z : 9999;
        }
        packetGeo.getAttribute("position").needsUpdate = true;

        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        for (const item of disposables) item.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <canvas aria-hidden="true" className="hero-flow" ref={canvasRef} />;
}
