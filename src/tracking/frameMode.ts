/**
 * Modo de preparo do quadro da câmera, compartilhado entre o ArSession e o
 * carregador de quadros trocado do MindAR (patch/inputLoader.ts).
 *
 * Procurando a tatuagem, os quadros alternam entre normalizados em contraste
 * local e crus (ajuda no reconhecimento com sombra). Depois de reconhecida, só
 * quadros crus: alternar os dois tipos faria a pose "pular" a cada quadro,
 * porque o rastreador casa o desenho em imagens com contraste diferente.
 */
let searching = true;

export function setSearchingFrames(value: boolean): void {
  searching = value;
}

export function isSearchingFrames(): boolean {
  return searching;
}
