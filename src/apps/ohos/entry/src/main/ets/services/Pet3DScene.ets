import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  Color,
  EnvironmentBackgroundType,
  Geometry,
  Light,
  LightType,
  Material,
  MaterialType,
  MeshResource,
  MetallicRoughnessMaterial,
  Position3,
  Quaternion,
  Scale3,
  Scene,
  SceneResourceFactory,
  SphereGeometry,
  Vec4,
} from '@kit.ArkGraphics3D';

const DOMAIN: number = 0x0000;
const TAG: string = 'BitFunPet3D';

/** ArkGraphics 3D is a PC/2in1-class capability; check before touching it. */
const GRAPHICS_3D_SYSCAP: string = 'SystemCapability.ArkUi.Graphics3D';

/** ~30 fps. The orb is decorative; a per-frame rate would only waste battery. */
const FRAME_INTERVAL_MS: number = 33;

/** Sphere radius in scene units. The camera sits at z=3, so this fills the pet. */
const ORB_RADIUS: number = 0.62;

/**
 * Decorative 3D backdrop for the Agent companion pet.
 *
 * It is intentionally model-free: a lit PBR sphere proves the Scene Kit path on
 * this device without shipping a glTF asset. Replace `ORB_RADIUS`/the geometry
 * with `Scene.load($rawfile('pet.glb'))` when a real model and animation exist;
 * camera, lights, material and the frame loop stay the same.
 *
 * The window behind it is transparent, so the render target must stay
 * transparent (`BACKGROUND_NONE`); the page passes `ModelType.TEXTURE` so the
 * GPU composites the texture instead of presenting an opaque surface.
 */
export class Pet3DScene {
  private scene: Scene | null = null;
  private orb: Geometry | null = null;
  private keyLight: Light | null = null;
  private rimLight: Light | null = null;
  private timerId: number = -1;
  private glow: number = 0.2;

  /**
   * Build the scene and start the frame loop. Returns `null` on any failure so
   * the pet keeps its normal transparent surface instead of a broken window.
   */
  async create(): Promise<Scene | null> {
    if (!canIUse(GRAPHICS_3D_SYSCAP)) {
      hilog.info(DOMAIN, TAG, 'ArkGraphics 3D is unavailable on this device; skipping the pet backdrop');
      return null;
    }
    try {
      const scene: Scene = await Scene.load();
      scene.environment.backgroundType = EnvironmentBackgroundType.BACKGROUND_NONE;
      const factory: SceneResourceFactory = scene.getResourceFactory();

      const camera = await factory.createCamera({ name: 'bitfun_pet_camera' }, { msaa: true });
      const cameraPosition: Position3 = { x: 0, y: 0, z: 3 };
      camera.position = cameraPosition;
      camera.enabled = true;

      const key: Light = await factory.createLight({ name: 'bitfun_pet_key' }, LightType.DIRECTIONAL);
      const keyColor: Color = { r: 0.55, g: 0.75, b: 1.0, a: 1.0 };
      key.color = keyColor;
      key.intensity = 1.6;
      key.rotation = this.eulerQuaternion(-0.45, 0.55, 0);
      key.enabled = true;

      // Cool rim light from the opposite side so the sphere keeps an edge in
      // both themes instead of flattening into a bright disc.
      const rim: Light = await factory.createLight({ name: 'bitfun_pet_rim' }, LightType.DIRECTIONAL);
      const rimColor: Color = { r: 0.35, g: 0.55, b: 1.0, a: 1.0 };
      rim.color = rimColor;
      rim.intensity = 0.9;
      rim.rotation = this.eulerQuaternion(0.5, -0.7, 0);
      rim.enabled = true;

      const material: Material =
        await factory.createMaterial({ name: 'bitfun_pet_orb_material' }, MaterialType.METALLIC_ROUGHNESS);
      const pbr: MetallicRoughnessMaterial = material as MetallicRoughnessMaterial;
      const baseColor: Vec4 = { x: 0.32, y: 0.62, z: 1.0, w: 1.0 };
      pbr.baseColor.factor = baseColor;
      const surface: Vec4 = { x: 0.0, y: 0.28, z: 0.65, w: 0.5 };
      pbr.material.factor = surface;
      const emissive: Vec4 = { x: 0.06, y: 0.12, z: 0.24, w: 1.0 };
      pbr.emissive.factor = emissive;
      const clearCoat: Vec4 = { x: 1.0, y: 0.0, z: 0.0, w: 1.0 };
      pbr.clearCoat.factor = clearCoat;

      const sphere: SphereGeometry = new SphereGeometry();
      sphere.radius = ORB_RADIUS;
      sphere.segmentCount = 48;
      const mesh: MeshResource =
        await factory.createMesh({ name: 'bitfun_pet_orb_mesh' }, sphere);
      const orb: Geometry = await factory.createGeometry({ name: 'bitfun_pet_orb' }, mesh);
      orb.mesh.materialOverride = material;

      this.scene = scene;
      this.orb = orb;
      this.keyLight = key;
      this.rimLight = rim;
      this.applyGlow();
      this.startFrameLoop();
      hilog.info(DOMAIN, TAG, 'pet 3D backdrop created');
      return scene;
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.warn(DOMAIN, TAG,
        `failed to create the pet 3D backdrop: code=${businessError.code} message=${businessError.message}`);
      this.dispose();
      return null;
    }
  }

  /**
   * Feed the same 0..1 activity signal the material used: it drives the key
   * light and a small breathing scale, so the sphere reacts to Agent state.
   */
  setGlow(value: number): void {
    const clamped: number = Math.max(0, Math.min(1, value));
    this.glow = clamped;
    this.applyGlow();
  }

  /** Stop the loop and release native scene resources. */
  dispose(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
    const scene: Scene | null = this.scene;
    this.scene = null;
    this.orb = null;
    this.keyLight = null;
    this.rimLight = null;
    if (scene !== null) {
      try {
        scene.destroy();
      } catch (error) {
        const businessError: BusinessError = error as BusinessError;
        hilog.warn(DOMAIN, TAG, `scene destroy failed: ${businessError.message}`);
      }
    }
  }

  private applyGlow(): void {
    const key: Light | null = this.keyLight;
    if (key !== null) {
      key.intensity = 0.8 + 2.2 * this.glow;
    }
    const rim: Light | null = this.rimLight;
    if (rim !== null) {
      rim.intensity = 0.4 + 1.2 * this.glow;
    }
    const orb: Geometry | null = this.orb;
    if (orb !== null) {
      const scale: number = 0.92 + 0.12 * this.glow;
      const orbScale: Scale3 = { x: scale, y: scale, z: scale };
      orb.scale = orbScale;
    }
  }

  private startFrameLoop(): void {
    if (this.timerId >= 0) {
      return;
    }
    this.timerId = setInterval(() => {
      const orb: Geometry | null = this.orb;
      const scene: Scene | null = this.scene;
      if (orb === null || scene === null) {
        return;
      }
      const seconds: number = Date.now() / 1000;
      const spin: Quaternion = this.eulerQuaternion(0.15, seconds * 0.6, 0);
      orb.rotation = spin;
      scene.renderFrame();
    }, FRAME_INTERVAL_MS);
  }

  /** Euler (radians) to a normalized quaternion for node/light rotation. */
  private eulerQuaternion(x: number, y: number, z: number): Quaternion {
    const cx: number = Math.cos(x / 2);
    const sx: number = Math.sin(x / 2);
    const cy: number = Math.cos(y / 2);
    const sy: number = Math.sin(y / 2);
    const cz: number = Math.cos(z / 2);
    const sz: number = Math.sin(z / 2);
    const q: Quaternion = {
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
    return q;
  }
}
