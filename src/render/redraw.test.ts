import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createRedrawDetector } from './redraw';

function setup() {
  const root = new Group();
  const a = new MeshBasicMaterial();
  const b = new MeshBasicMaterial();
  const mesh = new Mesh(new BoxGeometry(), a);
  root.add(mesh);
  const camera = new PerspectiveCamera();
  const detector = createRedrawDetector();
  return { root, mesh, a, b, camera, detector };
}

describe('描き直しの判定（S1-24）', () => {
  it('最初は描き、何も変わらなければ描かない', () => {
    const { root, camera, detector } = setup();
    expect(detector.needsRedraw(root, camera, [0])).toBe(true);
    expect(detector.needsRedraw(root, camera, [0])).toBe(false);
  });

  it('位置・向き・見えるか・材質・オブジェクトの増減・カメラ・追加の数が変わると描く', () => {
    const { root, mesh, b, camera, detector } = setup();
    const check = () => detector.needsRedraw(root, camera, [0]);
    check();
    mesh.rotation.z = 0.1;
    expect(check()).toBe(true);
    expect(check()).toBe(false);
    mesh.visible = false;
    expect(check()).toBe(true);
    mesh.visible = true;
    expect(check()).toBe(true);
    mesh.material = b;
    expect(check()).toBe(true);
    b.needsUpdate = true;
    expect(check()).toBe(true);
    root.add(new Group());
    expect(check()).toBe(true);
    camera.position.x = 5;
    expect(check()).toBe(true);
    expect(check()).toBe(false);
    expect(detector.needsRedraw(root, camera, [1])).toBe(true);
  });

  it('invalidate すると次は必ず描く', () => {
    const { root, camera, detector } = setup();
    detector.needsRedraw(root, camera, []);
    detector.invalidate();
    expect(detector.needsRedraw(root, camera, [])).toBe(true);
    expect(detector.needsRedraw(root, camera, [])).toBe(false);
  });
});
