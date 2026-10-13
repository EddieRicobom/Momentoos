import * as THREE from 'three';

const ACCENT = 0x3ee6b0;

/**
 * Objeto de teste ancorado na tatuagem: moldura + preenchimento translúcido no
 * tamanho exato do alvo, um cubo no centro e eixos de coordenadas.
 *
 * Convenção do MindARThree (conferida em src/image-target/three.js): o grupo
 * da âncora tem a origem no CENTRO do alvo e 1 unidade = LARGURA do alvo. Logo
 * um plano de 1 × (altura/largura) cobre exatamente a imagem cadastrada. Se a
 * moldura ficar deslocada ou com proporção errada na tela, o problema está no
 * alinhamento do rastreamento, não no desenho do objeto.
 */
export function createVirtualObject(targetWidth: number, targetHeight: number): THREE.Group {
  const aspect = targetHeight / targetWidth;
  const group = new THREE.Group();

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, aspect),
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(fill);

  // Moldura feita de barras finas (linhas WebGL têm sempre 1 px de espessura
  // e quase não aparecem sobre a imagem da câmera).
  const t = 0.014;
  const barMaterial = new THREE.MeshBasicMaterial({ color: ACCENT });
  const horizontal = new THREE.PlaneGeometry(1 + t, t);
  const vertical = new THREE.PlaneGeometry(t, aspect + t);
  const bars: Array<[THREE.PlaneGeometry, number, number]> = [
    [horizontal, 0, aspect / 2],
    [horizontal, 0, -aspect / 2],
    [vertical, -0.5, 0],
    [vertical, 0.5, 0],
  ];
  for (const [geometry, x, y] of bars) {
    const bar = new THREE.Mesh(geometry, barMaterial);
    bar.position.set(x, y, 0.001);
    group.add(bar);
  }

  const cubeSize = Math.min(1, aspect) * 0.22;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
  );
  cube.position.z = cubeSize / 2;
  group.add(cube);

  const axes = new THREE.AxesHelper(Math.min(1, aspect) * 0.4);
  group.add(axes);

  return group;
}
