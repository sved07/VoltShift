import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls, QuadraticBezierLine } from '@react-three/drei';
import * as THREE from 'three';
import type { GridZone, IndustrialWorkload } from '../../types';
import { STATUS_META, carbonColor } from '../../utils/carbon';
import {
  arcMidpoint,
  layoutSites,
  layoutZones,
  routingFlows,
  utilisation,
  type Flow,
  type SiteLayout,
  type Vec3,
  type ZoneLayout,
} from './sceneLayout';

const BACKBONE_COLOR = '#22d3ee';
const PULSE_COLOR = '#22c55e';
const PULSES_PER_FLOW = 3;

interface GridSceneProps {
  zones: GridZone[];
  workloads: IndustrialWorkload[];
  reducedMotion: boolean;
  onSelectSite?: (id: string) => void;
}

/**
 * Stylised 3D view of energy routing across the four ISOs. Lightweight by design:
 * ~40 meshes, no post-processing, glow faked with additive halos.
 */
export default function GridScene({ zones, workloads, reducedMotion, onSelectSite }: GridSceneProps) {
  const zoneLayout = useMemo(() => layoutZones(zones), [zones]);
  const siteLayout = useMemo(() => layoutSites(workloads, zoneLayout), [workloads, zoneLayout]);
  const flows = useMemo(() => routingFlows(zoneLayout), [zoneLayout]);
  const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

  return (
    <Canvas
      camera={{ position: [0, 5.2, 9.6], fov: 38 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={reducedMotion ? 'demand' : 'always'}
      aria-hidden="true"
    >
      <ResponsiveCamera />
      <fog attach="fog" args={['#0F172A', 11, 26]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 6, 4]} intensity={40} color="#a5f3fc" />

      <Grid
        position={[0, -0.01, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#1e293b"
        sectionSize={2.5}
        sectionThickness={0.9}
        sectionColor="#164e63"
        fadeDistance={22}
        fadeStrength={1.6}
        infiniteGrid
      />

      {zoneLayout.map((a, i) =>
        zoneLayout.slice(i + 1).map((b) => (
          <QuadraticBezierLine
            key={`${a.zone.zone_id}-${b.zone.zone_id}`}
            start={a.position}
            end={b.position}
            mid={arcMidpoint(a.position, b.position)}
            color={BACKBONE_COLOR}
            lineWidth={1}
            transparent
            opacity={0.22}
          />
        )),
      )}

      {flows.map((flow) => (
        <FlowPulses key={`${flow.from.zone.zone_id}->${flow.to.zone.zone_id}`} flow={flow} animate={!reducedMotion} />
      ))}

      {siteLayout.map((site) => (
        <Line
          key={`link-${site.workload.id}`}
          points={[site.zonePosition, [site.position[0], 0.02, site.position[2]]]}
          color={STATUS_META[site.workload.status].color}
          lineWidth={1}
          transparent
          opacity={0.35}
        />
      ))}

      {zoneLayout.map((z) => (
        <ZoneNode key={z.zone.zone_id} layout={z} animate={!reducedMotion} />
      ))}

      {siteLayout.map((site) => (
        <SiteNode key={site.workload.id} site={site} onSelect={onSelectSite} />
      ))}

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        enableRotate={Boolean(finePointer)}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.35}
        minPolarAngle={0.65}
        maxPolarAngle={1.2}
        enableDamping
      />
    </Canvas>
  );
}

/** Pull the camera back on narrow/portrait viewports so all four ISOs stay in frame. */
function ResponsiveCamera() {
  const camera = useThree((state) => state.camera);
  const aspect = useThree((state) => state.size.width / Math.max(state.size.height, 1));
  useEffect(() => {
    const distance = 1 / Math.min(1, aspect / 1.7); // 1x at 16:9-ish, further back when narrower
    camera.position.set(0, 5.2 * distance, 9.6 * distance);
    camera.lookAt(0, 0, 0);
  }, [aspect, camera]);
  return null;
}

function ZoneNode({ layout, animate }: { layout: ZoneLayout; animate: boolean }) {
  const { zone, position } = layout;
  const color = carbonColor(zone.carbon_intensity);
  const halo = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!animate || !halo.current) return;
    halo.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.6 + position[0]) * 0.08);
  });

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.62, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-position[1] + 0.02}>
        <ringGeometry args={[0.72, 0.76, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} />
      </mesh>
      <Html center position={[0, 0.78, 0]} distanceFactor={9} zIndexRange={[1, 0]} className="pointer-events-none select-none">
        <div className="scene-label">
          <span className="scene-label__id">{zone.zone_id}</span>
          <span style={{ color }}>{Math.round(zone.carbon_intensity)} g</span>
        </div>
      </Html>
    </group>
  );
}

function SiteNode({ site, onSelect }: { site: SiteLayout; onSelect?: (id: string) => void }) {
  const { workload, position } = site;
  const color = STATUS_META[workload.status].color;
  const target = 0.25 + 1.15 * utilisation(workload);
  const body = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Height eases toward its target, so a BOOST/THROTTLE reads as motion, not a jump.
  useFrame((_, delta) => {
    const mesh = body.current;
    if (!mesh) return;
    mesh.scale.y = THREE.MathUtils.damp(mesh.scale.y, target, 6, delta);
    mesh.position.y = mesh.scale.y / 2;
    const s = THREE.MathUtils.damp(mesh.scale.x, hovered ? 1.18 : 1, 18, delta);
    mesh.scale.x = mesh.scale.z = s;
  });

  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();

  return (
    <mesh
      ref={body}
      position={[position[0], target / 2, position[2]]}
      scale={[1, target, 1]}
      onClick={(e) => {
        stop(e);
        onSelect?.(workload.id);
      }}
      onPointerOver={(e) => {
        stop(e);
        setHovered(true);
        document.body.style.cursor = onSelect ? 'pointer' : '';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
    >
      {workload.type === 'AI_TRAINING' ? <boxGeometry args={[0.26, 1, 0.26]} /> : <cylinderGeometry args={[0.14, 0.14, 1, 24]} />}
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hovered ? 1.2 : 0.55} transparent opacity={0.92} />
    </mesh>
  );
}

function FlowPulses({ flow, animate }: { flow: Flow; animate: boolean }) {
  const curve = useMemo(() => {
    const a = flow.from.position;
    const b = flow.to.position;
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...a),
      new THREE.Vector3(...arcMidpoint(a, b)),
      new THREE.Vector3(...b),
    );
  }, [flow]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const t = animate ? (clock.elapsedTime * 0.22 + i / PULSES_PER_FLOW) % 1 : (i + 0.5) / PULSES_PER_FLOW;
      mesh.position.copy(curve.getPoint(t));
      mesh.scale.setScalar(0.6 + Math.sin(t * Math.PI) * 0.6); // grow mid-flight, fade at the ends
    });
  });

  const start: Vec3 = flow.from.position;
  return (
    <>
      {Array.from({ length: PULSES_PER_FLOW }, (_, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} position={start}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshBasicMaterial color={PULSE_COLOR} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}
